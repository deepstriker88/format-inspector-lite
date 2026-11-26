import {open} from "node:fs/promises";
import {constants} from "node:fs";
import {pathToFileURL} from "node:url";

// Generated for this product. Destinations are fixed; input cannot select a host.
const PRODUCT = "format";
const BASE = "https://format-inspector.eztoolgo.duckdns.org";
const ENDPOINT = "/v1/inspect";
const MAX_FILE = 256*1024, MAX_RESPONSE = 256*1024, MAX_CALLS=500;
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(",")===keys;
const bytes=v=>Buffer.byteLength(v,"utf8");
const formats=new Set(["email","hostname","ipv4","ipv6","uuid","date","time","uri"]);
const ordinary=new Set(["TYPE_MISMATCH","REQUIRED","ADDITIONAL_PROPERTY","TOO_SHORT","TOO_LONG","BELOW_MINIMUM","ABOVE_MAXIMUM","TOO_FEW_ITEMS","TOO_MANY_ITEMS_RULE","NOT_IN_ENUM","INVALID_EMAIL","INVALID_HOSTNAME"]);
function invalid(){throw new TypeError("invalid_input");}
function boundedText(v,n){if(typeof v!=="string"||bytes(v)>n)invalid();return v;}
function payload(v){const body=JSON.stringify(v);if(bytes(body)>(PRODUCT==="form"?128:16)*1024)invalid();return body;}
function canonicalOrigin(v){
 boundedText(v,512);
 try{const u=new URL(v);if(!/^https?:\/\/[^/?#]+$/.test(v)||u.origin!==v||u.username||u.password||u.hostname.endsWith(".")||/[\s\\%@]/u.test(v))invalid();return v;}catch{invalid();}
}
function safeUrl(v){
 boundedText(v,4096);
 if(!/^https?:\/\/[^/?#]+/i.test(v)||/[\s\\\u0000-\u001f\u007f]/u.test(v)||v.slice(v.indexOf("://")+3).split(/[/?#]/,1)[0].includes("@"))invalid();
 return v;
}
function assertJsonTree(root){
 let count=0,stack=[[root,0]];
 while(stack.length){const [v,d]=stack.pop();if(++count>20000||d>16)invalid();
 if(typeof v==="number"&&!Number.isFinite(v))invalid();
 if(v&&typeof v==="object"){for(const [key,val] of Object.entries(v)){if(["__proto__","prototype","constructor"].includes(key))invalid();stack.push([val,d+1]);}}
 }
}
export function prepare(input,maxChecks=100){
 if(!Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>MAX_CALLS)invalid();
 assertJsonTree(input);
 let jobs=[];
 if(PRODUCT==="weburl"){
  if(!exact(input,"allowedOrigins,urls")||!Array.isArray(input.allowedOrigins)||!Array.isArray(input.urls)||!input.allowedOrigins.length||input.allowedOrigins.length>32)invalid();
  const origins=input.allowedOrigins.map(canonicalOrigin);if(new Set(origins).size!==origins.length)invalid();
  jobs=input.urls.map((url,i)=>({index:i+1,body:payload({url:safeUrl(url),options:{allowedOrigins:origins}})}));
 }else if(PRODUCT==="format"){
  if(!exact(input,"records")||!Array.isArray(input.records))invalid();
  jobs=input.records.map((r,i)=>{if(!exact(r,"format,value")||!formats.has(r.format))invalid();return {index:i+1,body:payload({format:r.format,value:boundedText(r.value,4096)})};});
 }else{
  if(!exact(input,"after,before,fixtures")||!object(input.before)||!object(input.after)||!Array.isArray(input.fixtures)||bytes(JSON.stringify(input.before))>16384||bytes(JSON.stringify(input.after))>16384)invalid();
  jobs=input.fixtures.flatMap((value,i)=>[{index:i+1,side:"before",body:payload({value,schema:input.before})},{index:i+1,side:"after",body:payload({value,schema:input.after})}]);
 }
 if(jobs.length<1||jobs.length>maxChecks)invalid();
 return jobs;
}
function verdict(result){
 if(!object(result))throw new Error("invalid_response");
 if(PRODUCT==="weburl"){
  if(typeof result.ok!=="boolean")throw new Error("invalid_response");
  // The service can reject additional policy conditions; do not echo URLs or error text.
  return result.ok?"accepted":"rejected";
 }
 if(typeof result.valid!=="boolean")throw new Error("invalid_response");
 if(result.valid)return "accepted";
 if(PRODUCT==="format"){
  return result.code==="INVALID_FORMAT"?"rejected":"indeterminate";
 }
 return Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(e=>object(e)&&ordinary.has(e.code))?"rejected":"indeterminate";
}
async function readResponse(response){
 const reader=response.body?.getReader();if(!reader)throw new Error("invalid_response");
 let total=0,parts=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_RESPONSE)throw new Error("invalid_response");parts.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{});}
 let parsed;
 try{parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts)));}catch{throw new Error("invalid_response");}
 return parsed;
}
async function request(path,body,key,transport){
 const response=await transport(BASE+path,{method:body===undefined?"GET":"POST",headers:{"authorization":"Bearer "+key,"content-type":"application/json","accept":"application/json"},...(body===undefined?{}:{body}),redirect:"error",signal:AbortSignal.timeout(10000)});
 if(response.status!==200){await response.body?.cancel().catch(()=>{});throw new Error("http_"+response.status);}
 return readResponse(response);
}
export async function run(input,{send=false,maxChecks=100,key="",transport=fetch}={}){
 const jobs=prepare(input,maxChecks);
 const planned=jobs.length;
 if(!send)return {product:PRODUCT,mode:"preview",plannedChecks:planned,networkRequests:0,gate:"not_run"};
 if(typeof key!=="string"||!key||key.length>128||!/^[A-Za-z0-9_-]+$/.test(key))throw new Error("api_key_required");
 let attempted=0,completed=0,results=[],pending=null,usage=null;
 try{
  const current=await request("/v1/usage",undefined,key,transport);
  if(!object(current)||current.status!=="active"||!Number.isSafeInteger(current.used)||!Number.isSafeInteger(current.limit)||current.used<0||current.limit<0)throw new Error("usage_unavailable");
  if(current.limit-current.used<planned)return {product:PRODUCT,mode:"send",plannedChecks:planned,completedChecks:0,attemptedChecks:0,gate:"not_run",reason:"insufficient_quota",usage:{used:current.used,limit:current.limit}};
  usage={used:current.used,limit:current.limit};
  for(const j of jobs){
   attempted++;
   const res=await request(ENDPOINT,j.body,key,transport);
   const v=verdict(res);
   completed++;
   if(PRODUCT==="form"){
    if(j.side==="before")pending=v;
    else{const change=pending==="indeterminate"||v==="indeterminate"?"indeterminate":pending===v?"unchanged":v==="accepted"?"newly_accepted":"newly_rejected";results.push({index:j.index,before:pending,after:v,change});pending=null;}
   }else results.push({index:j.index,verdict:v});
   if(object(res.usage)&&Number.isSafeInteger(res.usage.used)&&Number.isSafeInteger(res.usage.limit))usage={used:res.usage.used,limit:res.usage.limit};
  }
 }catch(e){
  const reason=typeof e?.message==="string"&&/^http_[1-5][0-9]{2}$/.test(e.message)?e.message:e?.message==="usage_unavailable"?"usage_unavailable":"request_failed";
  return {product:PRODUCT,mode:"send",plannedChecks:planned,attemptedChecks:attempted,completedChecks:completed,gate:"incomplete",reason,results,usage,unconfirmedChecks:attempted-completed};
 }
 const blocked=PRODUCT==="form"?results.some(r=>r.change!=="unchanged"):results.some(r=>r.verdict!=="accepted");
 return {product:PRODUCT,mode:"send",plannedChecks:planned,attemptedChecks:attempted,completedChecks:completed,gate:blocked?"block":"pass",results,usage};
}
function strictInput(text){
 let i=0,n=0;
 const ws=()=>{while(i<text.length&&/[\t\n\r ]/.test(text[i]))i++;};
 function str(){
  if(text[i]!=='"')invalid();
  const start=i++;
  while(i<text.length){
   const c=text[i++];
   if(c==='"')return JSON.parse(text.slice(start,i));
   if(c==='\\'){if(i>=text.length)invalid();i++;}
  }invalid();
 }
 function visit(d){
  if(d>16||++n>20000)invalid();ws();const c=text[i];
  if(c==='{'){
   const keys=new Set();i++;ws();if(text[i]==='}'){i++;return;}
   for(;;){ws();const key=str();if(keys.has(key))invalid();keys.add(key);ws();if(text[i++]!==':')invalid();visit(d+1);ws();const e=text[i++];if(e==='}')return;if(e!==',')invalid();}
  }else if(c==='['){
   i++;ws();if(text[i]===']'){i++;return;}for(;;){visit(d+1);ws();const e=text[i++];if(e===']')return;if(e!==',')invalid();}
  }else if(c==='"')str();
  else{const a=i;while(i<text.length&&!/[\t\n\r ,}\]]/.test(text[i]))i++;if(i===a)invalid();const v=JSON.parse(text.slice(a,i));if(typeof v==="number"&&!Number.isFinite(v)||v!==null&&typeof v==="object")invalid();}
 }
 visit(0);ws();if(i!==text.length)invalid();return JSON.parse(text);
}
async function readInput(path){
 const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const st=await handle.stat();if(!st.isFile()||st.size>MAX_FILE)invalid();
  const buf=Buffer.alloc(MAX_FILE+1);let total=0;
  while(total<buf.length){const {bytesRead}=await handle.read(buf,total,buf.length-total,null);if(!bytesRead)break;total+=bytesRead;}
  if(total>MAX_FILE)invalid();
  return strictInput(new TextDecoder("utf-8",{fatal:true}).decode(buf.subarray(0,total)));
 }finally{await handle.close();}
}
async function main(){
 const args=process.argv.slice(2);
 if(!args.length||args[0]==="--help"){console.log("Usage: node automation.mjs input.json [--send] [--max-checks N]\nDefault is a local preview. --send uploads selected input to the product API and consumes quota. API key: EZTOOLGO_API_KEY. Exit: 0 pass/preview, 1 finding, 2 incomplete/error.");return;}
 let send=false,maxChecks=100;
 for(let i=1;i<args.length;i++){
  if(args[i]==="--send"&&!send)send=true;
  else if(args[i]==="--max-checks"&&/^[1-9][0-9]{0,2}$/.test(args[i+1]||""))maxChecks=Number(args[++i]);
  else invalid();
 }
 const result=await run(await readInput(args[0]),{send,maxChecks,key:process.env.EZTOOLGO_API_KEY||""});
 console.log(JSON.stringify(result,null,2));
 process.exitCode=["pass","not_run"].includes(result.gate)&&!result.reason?0:result.gate==="block"?1:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error("Could not run. Check input JSON, documented limits and API key. No diagnostic input or key is printed.");process.exitCode=2;});
