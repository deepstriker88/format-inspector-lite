// Optional serverless request handler. No listener, process, API key, or cloud service is started here.
import {inspectBatch,inspectCsv} from './index.js';
const SAFE_HEADERS=Object.freeze({
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'none'"
});
const reply=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...SAFE_HEADERS,...extra}});
async function boundedBody(request,maxBytes){
 const header=request.headers.get('content-length');
 if(header!==null){
  const declared=Number(header);
  if(!Number.isSafeInteger(declared)||declared<0)throw new TypeError('invalid content length');
  if(declared>maxBytes)throw new RangeError('payload too large');
 }
 if(!request.body)return '';
 const reader=request.body.getReader();
 let size=0;const chunks=[];
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw new TypeError('invalid body chunk');
   size+=value.byteLength;
   if(size>maxBytes)throw new RangeError('payload too large');
   chunks.push(value);
  }
 }catch(error){try{await reader.cancel();}catch{}throw error;}
 finally{reader.releaseLock();}
 const payload=new Uint8Array(size);
 let offset=0;for(const chunk of chunks){payload.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(payload);
}
function parseRows(text,media){
 if(media==='text/csv')return inspectCsv(text);
 let input;
 if(media==='application/x-ndjson'){
  input=text.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
 }else input=JSON.parse(text);
 if(!Array.isArray(input)||!input.length)throw new TypeError('expected nonempty JSON array');
 return inspectBatch(input);
}
export function createInspectorHttpHandler({authorize,consumeQuota,maxBytes=65536}={}){
 if(typeof authorize!=='function'||typeof consumeQuota!=='function')throw new TypeError('authorization and quota checks required');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1048576)throw new RangeError('invalid maximum payload size');
 return async request=>{
  if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'},{allow:'POST'});
  const media=(request.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(!['application/json','application/x-ndjson','text/csv'].includes(media))return reply(415,{error:'UNSUPPORTED_MEDIA_TYPE'});
  let allowed=false;
  try{allowed=await authorize(request);}catch{return reply(401,{error:'UNAUTHORIZED'});}
  if(allowed!==true)return reply(401,{error:'UNAUTHORIZED'});
  let quota=false;
  try{quota=await consumeQuota(request);}catch{return reply(503,{error:'QUOTA_UNAVAILABLE'});}
  if(quota!==true)return reply(429,{error:'RATE_LIMITED'});
  let text;
  try{text=await boundedBody(request,maxBytes);}
  catch(error){return reply(error instanceof RangeError?413:400,{error:error instanceof RangeError?'PAYLOAD_TOO_LARGE':'INVALID_INPUT'});}
  try{
   const results=parseRows(text,media);
   const valid=results.filter(row=>row.valid).length;
   return reply(200,{total:results.length,valid,invalid:results.length-valid,results});
  }catch{return reply(400,{error:'INVALID_INPUT'});}
 };
}
