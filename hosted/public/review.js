import {compareContract} from "./contract.js";
const limits={rules:16384,previous:1048576,current:1048576};
const sample={rules:JSON.stringify({version:1,columns:[{name:"id",required:true,unique:true},{name:"email",required:true,format:"email"}]},null,2),previous:"id,email\n1,one@example.com\n2,two@example.com",current:"id,email\n1,bad\n1,two@example.com"};
const reportName="csv-delivery-review.json";
export function check(input){
 for(const [key,cap] of Object.entries(limits)){const v=input[key];if(typeof v!=="string"||!v.length||v.length>cap||new TextEncoder().encode(v).length>cap)throw new RangeError("input limit");}
 return compareContract(input.previous,input.current,input.rules);
}
export function describe(r){
 const comparable=r.comparable;
 const current=r.current;
 const issueRows=(current.issues||[]).map(x=>"Column "+(x.column??"row")+" · "+x.code+" · "+x.count+" occurrence(s) · examples: "+x.exampleRows.join(", "));
 const header=[];
 if(!current.header.valid){header.push("Current header: "+current.header.missing+" missing, "+current.header.unexpected+" unexpected, "+current.header.duplicateHeaders+" duplicate; order changed: "+current.header.orderChanged);}
 if(!r.previous.header.valid){header.push("Previous header is not compatible with the contract.");}
 return {state:!comparable?"incomparable":current.valid?"pass":"fail",title:!comparable?"Not comparable":current.valid?"Current delivery passes":"Current delivery has issues",
 detail:!comparable?"At least one header failed. Row-quality changes cannot be compared. Current verdict: "+(current.valid?"passes":"fails")+".":"Compare the same reviewed contract across both deliveries. Positive change in invalid rate means deterioration.",
 metrics:[["Previous rows",r.previous.rows],["Current rows",current.rows],["Previous invalid rows",r.previous.invalidRows??"Not checked"],["Current invalid rows",current.invalidRows??"Not checked"],["Invalid-rate change (pp)",r.delta.invalidRatePercentagePoints??"Not comparable"]],
 groups:[["Header findings",header],["Current delivery findings",issueRows],["Changed issue counts",(r.delta.issues||[]).map(x=>"Column "+(x.column??"row")+" · "+x.code+" · "+x.previous+" → "+x.current)]]};
}

if(typeof document!=="undefined"){
const $=id=>document.getElementById(id);
const ids=Object.keys(limits);
const inputs=ids.map($);
let report=null,revision=0,pending=0;
const status=$("status"),summary=$("summary"),findings=$("findings"),technical=$("technical"),result=$("result"),fileStatus=$("file-status");
function reset(){
 report=null;revision++;
 status.dataset.state="idle";status.textContent="Ready to compare locally";
 summary.textContent="Try an example or supply three inputs.";
 findings.replaceChildren();result.textContent="";technical.hidden=true;technical.open=false;$("download").disabled=true;
}
function metric(label,value){
 const node=document.createElement("div");node.className="metric";
 const n=document.createElement("strong"),text=document.createElement("span");n.textContent=String(value);text.textContent=label;node.append(n,text);return node;
}
function message(text){const p=document.createElement("p");p.textContent=text;return p;}
function group(title,rows){
 const h=document.createElement("h3");h.textContent=title;
 const ul=document.createElement("ul");
 for(const row of rows){const li=document.createElement("li");li.textContent=row;ul.append(li);}
 findings.append(h,ul);
}
function display(r){
 report=r;summary.replaceChildren();findings.replaceChildren();
 const model=describe(r);status.dataset.state=model.state;status.textContent=model.title;
 summary.append(message(model.detail));
 const metrics=document.createElement("div");metrics.className="metrics";
 for(const [label,value] of model.metrics)metrics.append(metric(label,value));
 summary.append(metrics);
 for(const [title,rows] of model.groups)if(rows.length)group(title,rows);
 result.textContent=JSON.stringify(r,null,2);technical.hidden=false;technical.open=false;$("download").disabled=false;
}
function setBusy(){
 $("run").disabled=pending>0;$("example").disabled=pending>0;
 for(const id of ids){$(id+"-file").disabled=pending>0;$(id+"-open").disabled=pending>0;}
}
for(const input of inputs){
 input.addEventListener("input",()=>{reset();fileStatus.textContent="";});
 const id=input.id,file=$(id+"-file");
 $(id+"-open").addEventListener("click",()=>file.click());
 input.addEventListener("keydown",event=>{if(!event.isComposing&&event.key==="Enter"&&(event.ctrlKey||event.metaKey)&&!$("run").disabled){event.preventDefault();$("run").click();}});
 file.addEventListener("change",async()=>{
  const chosen=file.files?.[0];file.value="";
  if(!chosen)return;
  if(input.value&&!window.confirm("Replace this field with the selected file?"))return;
  if(chosen.size>limits[id]){fileStatus.textContent="File exceeds the limit; existing input retained.";return;}
  const token=++revision;pending++;setBusy();
  try{
   const bytes=await chosen.arrayBuffer();
   if(bytes.byteLength>limits[id])throw new RangeError("input limit");
   const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
   if(token!==revision)return;
   input.value=text;reset();fileStatus.textContent="Local file loaded. No upload.";
  }catch{if(token===revision)fileStatus.textContent="Could not read a bounded UTF-8 file; existing input retained.";}
  finally{pending--;setBusy();}
 });
}
function revealResult(){
 const rect=status.getBoundingClientRect();
 if(rect.top<0||rect.bottom>window.innerHeight){
  status.scrollIntoView({block:"nearest",behavior:"instant"});
 }
}
$("run").addEventListener("click",()=>{
 if(pending)return;
 reset();fileStatus.textContent="";
 try{display(check(Object.fromEntries(inputs.map(i=>[i.id,i.value]))));}
 catch{status.dataset.state="incomparable";status.textContent="Comparison unavailable";summary.textContent="Check all inputs, supported rules, file size and syntax. No report was produced.";}
 revealResult();
});
$("example").addEventListener("click",()=>{
 if(pending)return;
 if(inputs.some(i=>i.value)&&!window.confirm("Replace current inputs with the example?"))return;
 for(const input of inputs)input.value=sample[input.id];$("run").click();
});
$("clear").addEventListener("click",()=>{
 for(const input of inputs)input.value="";
 reset();fileStatus.textContent="";inputs[0].focus();
});
$("download").addEventListener("click",()=>{
 if(!report)return;
 const blob=new Blob([JSON.stringify(report,null,2)+"\n"],{type:"application/json"});
 const url=URL.createObjectURL(blob);
 try{const a=document.createElement("a");a.href=url;a.download=reportName;document.body.append(a);a.click();a.remove();}
 finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
reset();for(const id of ["run","example","clear"])$(id).disabled=false;setBusy();

}
