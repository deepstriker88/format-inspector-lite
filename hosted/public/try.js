import {csvRows} from "./csv.js";
import {csvToRecords,recordsToCsv} from './convert.js';
import {strictJson} from './strict-json.js';
import {inspectFormat, inspectCsv, inspectJson, inspectTableCsv, explainResult} from './core.js';
const LIMIT=65536;
function bounded(s){if(typeof s!=='string'||s.length>LIMIT||new TextEncoder().encode(s).length>LIMIT)throw new RangeError('Input exceeds 64 KiB');}
export function check({value,schema,mode,format,profile="",mapping=null}){
  bounded(value);

  if(mode==='single'){const r=inspectFormat(format,value);return {...r,explanation:explainResult(r)};}
  if(mode==='csv')return inspectCsv(value);
  if(mode==='table')return inspectTableCsv(value,mapping);
  if(mode==='json'){strictJson(value,{maxBytes:LIMIT,maxNodes:20000});const rows=inspectJson(value);if(!rows.length)throw new RangeError('At least one record is required');return rows;}
  if(mode==='csv_to_json')return csvToRecords(value,profile);
  if(mode==='json_to_csv')return recordsToCsv(value,profile);
  throw new TypeError('Unsupported mode');
}
export async function readLocalText(file){
 if(!file||!Number.isInteger(file.size)||file.size<0||file.size>LIMIT)throw new RangeError("File exceeds 64 KiB");
 const bytes=await file.arrayBuffer();
 if(bytes.byteLength!==file.size||bytes.byteLength>LIMIT)throw new RangeError("File size changed or exceeds 64 KiB");
 return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
if(typeof document!=='undefined'){
const $=id=>document.getElementById(id);
const resultPanel=$("result-panel"), copyButton=$("copy-result"), copyFeedback=$("copy-feedback");
let safeCopy="",conversion=null,automationInput=null;
let inputRevision=0;
function bindFile(field,afterLoad=()=>{}){
 const picker=$(field.id+"-file"),button=$(field.id+"-open"),feedback=$("file-feedback");
 button.addEventListener("click",()=>picker.click());
 picker.addEventListener("change",async()=>{
  const file=picker.files?.[0];picker.value="";
  if(!file)return;
  if(field.value&&!window.confirm("Replace the current field with this local file?"))return;
  const revision=++inputRevision;
  feedback.textContent="Reading locally…";
  try{
   const text=await readLocalText(file);
   if(revision!==inputRevision)return;
   afterLoad(file);
   field.value=text;invalidateColumns();reset();feedback.textContent="File loaded locally.";
  }catch{
   if(revision===inputRevision)feedback.textContent="File not loaded. Choose valid UTF-8 text no larger than 64 KiB.";
  }
 });
}

function clearCopy(){automationInput=null;$("automation-export").hidden=true;$("automation-export").open=false;conversion=null;$("save-conversion").hidden=true;$("save-conversion").disabled=true;$("technical-label").textContent="Technical result (JSON)";safeCopy="";copyButton.disabled=true;copyFeedback.textContent="";resultPanel.hidden=true;}
function setCopy(text){safeCopy=text;copyFeedback.textContent="";copyButton.disabled=!text;resultPanel.hidden=false;}
copyButton.addEventListener("click",async()=>{
 const captured=safeCopy;if(!captured)return;
 try{await navigator.clipboard.writeText(captured);if(safeCopy===captured)copyFeedback.textContent="Copied.";}
 catch{if(safeCopy===captured)copyFeedback.textContent="Clipboard unavailable. Select the result text to copy manually.";}
});
const value=$('value'),status=$('status'),result=$('result'),summary=$('summary'),technical=$('technical');
const reset=()=>{inputRevision++;$("file-feedback").textContent="";clearCopy();status.textContent='Ready to check locally';status.dataset.state='idle';summary.textContent='Run a check to see the result.';result.textContent='';technical.open=false;technical.hidden=true;};
const mode=$('mode'),format=$('format'),profile=$('conversion-profile');
let tableHeaders=[],tableSource=null;
const tableFields=$("table-fields"),tableNote=$("table-note");
const supportedFormats=["email","hostname","ipv4","ipv6","uuid","date","time","uri"];
function invalidateColumns(){
 tableHeaders=[];tableSource=null;tableFields.replaceChildren();
 tableNote.textContent="Paste ordinary CSV, then read headers and choose formats.";
}
function readColumns(preset={}){
 invalidateColumns();
 try{
  bounded(value.value);
  const rows=csvRows(value.value,{maxRows:100,maxColumns:100}),h=rows.shift();
  if(!rows.length||!h?.length||new Set(h).size!==h.length||h.some(x=>!x||x.length>128))throw Error();
  tableHeaders=h;tableSource=value.value;
  for(let i=0;i<h.length;i++){
   const row=document.createElement("div");row.className="table-column";
   const label=document.createElement("label"),sel=document.createElement("select");sel.id="table-column-"+i;label.htmlFor=sel.id;label.textContent=h[i];
   const skip=document.createElement("option");skip.value="";skip.textContent="Skip";sel.append(skip);
   for(const type of supportedFormats){const o=document.createElement("option");o.value=type;o.textContent=type;sel.append(o);}
   if(Object.hasOwn(preset,h[i]))sel.value=preset[h[i]];
   sel.addEventListener("change",reset);row.append(label,sel);tableFields.append(row);
  }
  tableNote.textContent=h.length+" columns · "+rows.length+" data rows. Select up to 20 columns.";
 }catch{invalidateColumns();tableNote.textContent="CSV headers unavailable. Check duplicate or empty names, syntax and limits.";}
}
function tableMapping(){
 if(tableSource!==value.value||!tableHeaders.length)throw TypeError("Read headers first");
 const mapping=Object.create(null);
 for(let i=0;i<tableHeaders.length;i++){const v=$("table-column-"+i).value;if(v)mapping[tableHeaders[i]]=v;}
 if(!Object.keys(mapping).length||Object.keys(mapping).length>20)throw TypeError("Choose 1–20 columns");
 return mapping;
}
$("read-columns").addEventListener("click",()=>{reset();readColumns();});
const conversionMode=()=>['csv_to_json','json_to_csv'].includes(mode.value);
function showMode(){const convert=conversionMode();$('table-options').hidden=mode.value!=='table';$('format-wrap').hidden=mode.value!=='single';$('conversion-options').hidden=!convert;$('run').textContent=convert?'Convert locally':'Check input';$('conversion-label').textContent=mode.value==='csv_to_json'?'Integer columns (JSON list)':'Ordered field map (JSON pairs)';$('conversion-help').textContent=mode.value==='csv_to_json'?'Leave blank to keep every cell as text. Example: [\"qty\"]':'Leave blank for exact matching text columns. Example: [[\"ID\",\"/id\"]]';}
const example=()=>{if(mode.value==='csv_to_json'){profile.value='';value.value='sku,qty\n0042,7';}else if(mode.value==='json_to_csv'){profile.value='';value.value='[{\"sku\":\"0042\",\"qty\":\"7\"}]';}else if(mode.value==='single'){format.value='email';value.value='user@example.com';}else if(mode.value==='table'){value.value='customer,email,ip\nAlice,user@example.com,127.0.0.1\nBob,bad,999.1.2.3';readColumns({email:'email',ip:'ipv4'});}else if(mode.value==='csv'){value.value='format,value\nemail,user@example.com\nipv4,999.1.2.3';}else{value.value=JSON.stringify([{format:'email',value:'user@example.com'},{format:'ipv4',value:'999.1.2.3'}],null,2);}};
const options=()=>({mode:mode.value,format:format.value,value:value.value,profile:profile.value,mapping:mode.value==='table'?tableMapping():null});
const clear=()=>{value.value='';profile.value='';invalidateColumns();};
mode.addEventListener('change',()=>{invalidateColumns();profile.value='';$('conversion-options').open=false;showMode();reset();});
profile.addEventListener('input',reset);
$('save-conversion').addEventListener('click',()=>{
 if(!conversion)return;
 const blob=new Blob([conversion.text],{type:conversion.extension==='csv'?'text/csv;charset=utf-8':'application/json'});
 const url=URL.createObjectURL(blob);
 try{const a=document.createElement('a');a.href=url;a.download='converted-records.'+conversion.extension;document.body.append(a);a.click();a.remove();}
 finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
function updateAutomation(){
 try{
  let records;
  if(mode.value==="csv"){
   const rows=csvRows(value.value,{maxRows:100,maxColumns:2}),header=rows.shift();
   if(header?.length!==2||!header.includes("format")||!header.includes("value")||rows.some(r=>r.length!==2))return;
   records=rows.map(r=>({format:r[header.indexOf("format")],value:r[header.indexOf("value")]}));
  }else if(mode.value==="table"){
   const rows=csvRows(value.value,{maxRows:100,maxColumns:100}),header=rows.shift(),mapping=tableMapping();
   if(rows.some(r=>r.length!==header.length))return;
   const pairs=Object.entries(mapping).map(([name,format])=>({index:header.indexOf(name),format}));
   if(rows.length*pairs.length>500)return;
   records=rows.flatMap(row=>pairs.map(({index,format})=>({format,value:row[index]})));
  }else if(mode.value==="json"){
   records=strictJson(value.value,{maxBytes:LIMIT,maxNodes:20000});
  }else return;
  if(!Array.isArray(records)||!records.length||records.length>500||records.some(r=>!r||typeof r!=="object"||Array.isArray(r)||!["email","hostname","ipv4","ipv6","uuid","date","time","uri"].includes(r.format)||typeof r.value!=="string"||new TextEncoder().encode(r.value).length>4096))return;
  automationInput={records:records.map(({format,value})=>({format,value}))};
  if(new TextEncoder().encode(JSON.stringify(automationInput,null,2)).length>256*1024-1){automationInput=null;return;}
  $("automation-count").textContent=records.length+" existing API calls per run. "+(records.length>100?"Use --max-checks "+records.length+". ":"")+"No upload from this page.";
  $("automation-export").hidden=false;
 }catch{automationInput=null;}
}
$("export-ci").addEventListener("click",()=>{
 if(!automationInput)return;
 if(!window.confirm("Save actual inputs locally? Do not share this file or upload it without authorization."))return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(automationInput,null,2)+"\n"],{type:"application/json"}));
 try{const a=document.createElement("a");a.href=url;a.download="automation-input.json";document.body.append(a);a.click();a.remove();}
 finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
function render(r){
 if(r.converted){
  status.textContent='Conversion ready';status.dataset.state='pass';
  summary.replaceChildren();
  const count=document.createElement('p');count.textContent=r.rowCount+' records · '+r.columnCount+' columns';summary.append(count);
  const warning=document.createElement('p');warning.className='note';warning.textContent='Converted files contain the original data. Review before sharing. CSV importers may reinterpret text or leading zeros; use text import when needed.';summary.append(warning);
  result.textContent=r.text;technical.hidden=false;technical.open=false;$('technical-label').textContent='View converted data';
  conversion=r;$('save-conversion').hidden=false;$('save-conversion').disabled=false;
  setCopy('Conversion ready\n'+r.rowCount+' records · '+r.columnCount+' columns');return;
 }

  if(mode.value==="table"){
   status.textContent=r.valid?"All selected checks passed":"Issues found";
   status.dataset.state=r.valid?"pass":"fail";summary.replaceChildren();
   const text=document.createElement("p");text.textContent=r.rows+" rows · "+r.passed+" passed · "+r.failed+" failed checks";summary.append(text);
   const ul=document.createElement("ul");
   for(const item of r.results.filter(x=>!x.valid).slice(0,20)){
    const li=document.createElement("li");li.textContent="Row "+item.row+" · "+(item.column??"row width")+" — "+explainResult(item);ul.append(li);
   }
   if(r.failed)summary.append(ul);
   if(r.failed>20){const note=document.createElement("p");note.textContent="See technical result for remaining issues.";summary.append(note);}
   result.textContent=JSON.stringify(r,null,2);technical.hidden=false;technical.open=false;updateAutomation();
   setCopy(status.textContent+"\n"+r.rows+" rows · "+r.passed+" passed · "+r.failed+" failed checks");return;
  }
  const list=Array.isArray(r)?r:null;
  const errors=Array.isArray(r.errors)?r.errors:null;
  const failures=list?list.filter(x=>!x.valid).length:errors?Math.max(errors.length,r.valid===false?1:0):r.valid===false?1:0;
  const passed=list?list.length-failures:null;
  status.textContent=failures?'Issues found':'No reported issues';
  status.dataset.state=failures?'fail':'pass';
  summary.replaceChildren();
  const text=document.createElement('p');
  text.textContent=list?passed+' of '+list.length+' records passed.':errors?(failures?failures+' reported validation issue(s).':'The input satisfies the supported rules.'):(r.explanation||r.code||'Check complete.');
  summary.append(text);
  if(failures&&(list||errors)){
    const ul=document.createElement('ul');
    for(const item of (errors||list.filter(x=>!x.valid)).slice(0,10)){
      const li=document.createElement('li');
      li.textContent=errors?((item.path||'$')+' — '+(item.explanation||item.code)):('Record '+(Number.isInteger(item.index)?item.index+1:'?')+' — '+explainResult(item));
      ul.append(li);
    }
    summary.append(ul);
    if(failures>10){const note=document.createElement('p');note.textContent='More issues in the technical result.';summary.append(note);}
  }
  result.textContent=JSON.stringify(r,null,2);technical.hidden=false;technical.open=false;
  updateAutomation();
  setCopy(status.textContent+"\n"+(list?passed+" of "+list.length+" records passed.":failures?failures+" reported validation issue(s).":"Supported checks completed."));
}
function revealResult(){
 const rect=status.getBoundingClientRect();
 if(rect.top<0||rect.bottom>window.innerHeight){
  status.scrollIntoView({block:"nearest",behavior:"instant"});
 }
}
$('run').addEventListener('click',()=>{inputRevision++;$('file-feedback').textContent='';try{render(check(options()));}catch{reset();status.textContent='Input could not be checked';status.dataset.state='fail';summary.textContent=mode.value==='table'?'Read CSV headers and select 1–20 column formats. Check CSV syntax and input limits.':conversionMode()?'Check the column rules, duplicate keys, matching row widths, supported text and formula-like prefixes. No converted file was produced.':'Check JSON or CSV syntax, duplicate keys, record count and input limits. No validation result was produced.';resultPanel.hidden=false;} revealResult();});
value.addEventListener('input',()=>{invalidateColumns();reset();});
 document.addEventListener('keydown',event=>{if(!event.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!$('run').disabled&&['value','schema','conversion-profile'].includes(event.target.id)){event.preventDefault();$('run').click();}});
 value.addEventListener("keydown",event=>{if(!event.isComposing && event.key==="Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && mode.value==="single"&&!$("run").disabled){event.preventDefault();$("run").click();}});
format.addEventListener('change',reset);
$('example').addEventListener('click',()=>{if(value.value||profile.value){if(!window.confirm('Replace current input with an example?'))return;}example();$("run").click();});
$('clear').addEventListener('click',()=>{clear();reset();value.focus();});
showMode();reset();for(const id of ['run','example','clear'])$(id).disabled=false;$('loading').hidden=true;
bindFile(value,file=>{
 const ext=file.name.toLowerCase();
 if((mode.value==='csv_to_json'&&!ext.endsWith('.csv'))||(mode.value==='json_to_csv'&&!ext.endsWith('.json')))throw new TypeError('File type does not match conversion mode');
 if(ext.endsWith(".csv")){if(mode.value!=="csv_to_json"&&mode.value!=="table"){mode.value="csv";profile.value='';}}
 else if(ext.endsWith(".json")){if(mode.value!=="json_to_csv"){mode.value="json";profile.value='';}}
 else throw new TypeError("Choose CSV or JSON");
 showMode();
});
$("value-open").disabled=false;

}
