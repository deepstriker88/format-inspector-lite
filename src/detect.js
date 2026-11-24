// Identify all compatible syntax formats without guessing one authoritative semantic type.
// No raw values are retained in the detection result.
import {inspectFormat} from './index.js';
export const SUPPORTED_FORMATS=Object.freeze(['email','hostname','ipv4','ipv6','uuid','date','time','uri']);
function normalizeCandidates(candidates){
 if(!Array.isArray(candidates)||candidates.length<1||candidates.length>SUPPORTED_FORMATS.length)throw new TypeError('invalid candidates');
 const seen=new Set(),names=[];
 for(let i=0;i<candidates.length;i++){
  const desc=Object.getOwnPropertyDescriptor(candidates,String(i));
  if(!desc||!Object.hasOwn(desc,'value'))throw new TypeError('unsafe candidates');
  const name=desc.value;
  if(typeof name!=='string'||!SUPPORTED_FORMATS.includes(name)||seen.has(name))throw new TypeError('unsupported or duplicate candidate');
  seen.add(name);names.push(name);
 }
 return names;
}
function detectWithNames(value,names){
 if(typeof value!=='string')return {matched:false,ambiguous:false,matches:[],code:'NOT_STRING'};
 if(value.length>4096)return {matched:false,ambiguous:false,matches:[],code:'VALUE_TOO_LONG'};
 const matches=names.filter(name=>inspectFormat(name,value).valid);
 return {matched:matches.length>0,ambiguous:matches.length>1,matches,code:matches.length?'OK':'NO_MATCH'};
}
export function detectFormat(value,{candidates=SUPPORTED_FORMATS}={}){
 return detectWithNames(value,normalizeCandidates(candidates));
}
export function detectBatch(values,{candidates=SUPPORTED_FORMATS,maxItems=100}={}){
 const names=normalizeCandidates(candidates);
 if(!Array.isArray(values))throw new TypeError('expected array of values');
 if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>100)throw new RangeError('invalid maxItems');
 if(values.length>maxItems)throw new RangeError('batch too large');
 const results=[];let matched=0;
 for(let index=0;index<values.length;index++){
  let result;
  try{
   const desc=Object.getOwnPropertyDescriptor(values,String(index));
   if(desc&&!Object.hasOwn(desc,'value'))result={matched:false,ambiguous:false,matches:[],code:'ACCESSOR_PROPERTY'};
   else result=detectWithNames(desc?.value,names);
  }catch{result={matched:false,ambiguous:false,matches:[],code:'INSPECTION_FAILED'};}
  if(result.matched)matched++;
  results.push({index,...result});
 }
 return {count:values.length,matched,unmatched:values.length-matched,results};
}
