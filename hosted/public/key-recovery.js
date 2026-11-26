const $=id=>document.getElementById(id);
let config=null,prepared=null,busy=false;
const ids=["proof","new-key","new-code","saved"];
const wipe=()=>{for(const id of ids){if(id==="saved")$(id).checked=false;else $(id).value=""}prepared=null;$("commit").disabled=true};
function token(prefix){const a=crypto.getRandomValues(new Uint8Array(32));return prefix+btoa(String.fromCharCode(...a)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")}
function status(s){$("status").textContent=s}
function lock(v){busy=v;for(const id of ["prepare","mode","proof","clear"])$(id).disabled=v;$("commit").disabled=v||!prepared||!$("saved").checked}
$("mode").addEventListener("change",()=>{wipe();$("proof-label").textContent=$("mode").value==="enroll"?"Current API key":"Previously saved recovery code";status("Prepare a new recovery credential.")});
$("prepare").addEventListener("click",async()=>{
 if(busy)return;
 const proof=$("proof").value.trim(), mode=$("mode").value;wipe();$("proof").value=proof;lock(true);
 try{
  if(!config){const r=await fetch("/billing/recovery-config",{cache:"no-store"});if(!r.ok)throw Error();config=await r.json()}
  if(!/^[a-z][a-z0-9]{1,11}_(test|live)_$/.test(config.keyPrefix)||config.codePrefix!=="rcv_"+config.keyPrefix)throw Error();
  const expected=mode==="enroll"?config.keyPrefix:config.codePrefix;
  if(!proof.startsWith(expected)||proof.length!==expected.length+43)throw Error();
  prepared={mode,proof,newCode:token(config.codePrefix),newKey:mode==="rotate"?token(config.keyPrefix):""};
  $("new-key").value=prepared.newKey;$("new-code").value=prepared.newCode;
  status("Save the new recovery code"+(mode==="rotate"?" and API key":"")+" securely before confirming. Nothing has changed on the server yet.");
 }catch{status("Cannot prepare. Check the current credential and product/environment.")}finally{lock(false)}
});
$("saved").addEventListener("change",()=>{$("commit").disabled=busy||!prepared||!$("saved").checked});
$("commit").addEventListener("click",async()=>{
 if(busy||!prepared||!$("saved").checked)return;
 const p=prepared;lock(true);
 try{
  const enroll=p.mode==="enroll";
  const headers={"content-type":"application/json"};
  if(enroll)headers.authorization="Bearer "+p.proof;
  const body=enroll?{newCode:p.newCode}:{code:p.proof,newKey:p.newKey,newCode:p.newCode};
  const r=await fetch(enroll?"/billing/recovery/enroll":"/billing/recovery/rotate",{method:"POST",headers,body:JSON.stringify(body),cache:"no-store",credentials:"omit",redirect:"error"});
  const result=await r.json();
  if(!r.ok||result.ok!==true){status(r.status===409&&enroll?"Recovery already enrolled or conflict. Use your previously saved recovery code.":"Request rejected. Check your credential and subscription status.");return}
  prepared=null;$("proof").value="";$("saved").checked=false;
  status(enroll?"Recovery enabled. Store the code separately from your API key.":"Key rotated. The old key and recovery code no longer work; quota and subscription are unchanged.");
 }catch{status("Response unavailable. Keep both sets of credentials. Check the new API key using /v1/usage or your API client before retrying the previous recovery code.")}finally{lock(false)}
});
$("clear").addEventListener("click",()=>{if(!busy){wipe();status("Fields cleared.")}});
window.addEventListener("pagehide",wipe);
