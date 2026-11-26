// Local portable key backup. Never contacts the billing service.
const VERSION="eztoolgo-key-backup-v1", ITERATIONS=600000, MAX_FILE=4096;
const encoder=new TextEncoder();
const decoder=new TextDecoder("utf-8",{fatal:true});
const aad=encoder.encode(VERSION);
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
function unb64(value,min,max){
  if(typeof value!=="string"||value.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))throw Error("Invalid backup");
  const raw=Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
  if(raw.length<min||raw.length>max||b64(raw)!==value)throw Error("Invalid backup");
  return raw;
}
function credentials(product,key){
  if(typeof product!=="string"||!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(product))throw Error("Invalid product label");
  if(typeof key!=="string"||!/^[!-~]{8,512}$/.test(key))throw Error("Invalid API key format");
  return {product,key};
}
async function derive(pass,salt,c){
  if(typeof pass!=="string"||pass.length<16||pass.length>256)throw Error("Use a strong passphrase of 16–256 characters");
  const material=await c.subtle.importKey("raw",encoder.encode(pass),"PBKDF2",false,["deriveKey"]);
  return c.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",iterations:ITERATIONS,salt},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function encryptBackup(product,key,pass,c=globalThis.crypto){
  const data=credentials(product,key),salt=c.getRandomValues(new Uint8Array(16)),iv=c.getRandomValues(new Uint8Array(12));
  const k=await derive(pass,salt,c);
  const plain=encoder.encode(JSON.stringify(data));
  try{
    const cipher=new Uint8Array(await c.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},k,plain));
    return JSON.stringify({format:VERSION,salt:b64(salt),iv:b64(iv),ciphertext:b64(cipher)});
  } finally {plain.fill(0)}
}
export async function decryptBackup(text,pass,c=globalThis.crypto){
  if(typeof text!=="string"||text.length>MAX_FILE)throw Error("Invalid backup");
  const obj=JSON.parse(text);
  if(!obj||Array.isArray(obj)||typeof obj!=="object"||Object.keys(obj).sort().join(",")!=="ciphertext,format,iv,salt"||obj.format!==VERSION)throw Error("Invalid backup");
  const salt=unb64(obj.salt,16,16),iv=unb64(obj.iv,12,12),cipher=unb64(obj.ciphertext,17,2048);
  const k=await derive(pass,salt,c);
  const plain=new Uint8Array(await c.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},k,cipher));
  try{
    const data=JSON.parse(decoder.decode(plain));
    if(!data||Object.keys(data).sort().join(",")!=="key,product")throw Error("Invalid backup");
    return credentials(data.product,data.key);
  }finally{plain.fill(0)}
}
if(typeof document!=="undefined"){
 const $=id=>document.getElementById(id),status=$("status");
 let busy=false,generation=0;
 function clearResult(){$("restored").value="";$("download").hidden=true;}
 function lock(value){busy=value;for(const id of ["encrypt","decrypt","clear","file"])$(id).disabled=value;}
 async function run(mode){
  if(busy)return;
  clearResult();lock(true);const current=generation;status.textContent="Working locally…";
  try{
   if(!globalThis.crypto?.subtle)throw Error("Secure browser required");
   if(mode==="encrypt"){
    if($("password").value!==$("confirm").value)throw Error("Passphrases differ");
    const encrypted=await encryptBackup($("product").value,$("key").value,$("password").value);
    if(current!==generation)return;
    $("archive").value=encrypted;
    $("download").hidden=false;status.textContent="Encrypted backup ready. Download it and keep the passphrase separately.";
   }else{
    const result=await decryptBackup($("archive").value,$("password").value);
    if(current!==generation)return;
    $("product").value=result.product;$("restored").value=result.key;
    status.textContent="Key decrypted locally. It is not a new key; its current validity has not been checked.";
   }
  }catch{status.textContent="Unable to complete. Check the inputs, passphrase or backup format."}
  finally{$("key").value="";$("password").value="";$("confirm").value="";lock(false)}
 }
 $("encrypt").addEventListener("click",()=>run("encrypt"));
 $("decrypt").addEventListener("click",()=>run("decrypt"));
 $("file").addEventListener("change",async()=>{
  clearResult();const f=$("file").files[0];
  if(!f)return;
  if(f.size>MAX_FILE){status.textContent="Backup exceeds 4 KiB.";return}
  lock(true);
  try{$("archive").value=await f.text();status.textContent="Backup loaded locally."}
  catch{$("archive").value="";status.textContent="Could not read backup."}
  finally{$("file").value="";lock(false)}
 });
 $("archive").addEventListener("input",clearResult);
 $("download").addEventListener("click",()=>{
  if(busy||$("download").hidden)return;
  const url=URL.createObjectURL(new Blob([$("archive").value],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="eztoolgo-key-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 // Avoid retaining decrypted credentials when navigating away (including BFCache).
 window.addEventListener("pagehide",()=>{
  generation++;
  for(const id of ["product","key","password","confirm","archive","restored","file"])$(id).value="";
  clearResult();
 });
 $("clear").addEventListener("click",()=>{
  if(busy)return;for(const id of ["product","key","password","confirm","archive","restored","file"])$(id).value="";
  clearResult();status.textContent="Fields cleared.";
 });
}
