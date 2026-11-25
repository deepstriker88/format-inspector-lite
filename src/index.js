import {csvRows} from './csv.js';
// Offline, browser-compatible, dependency-free format inspector
const LIMIT=1048576;
const descriptions=Object.freeze({
 OK:'Value matches the selected format',
 UNSUPPORTED_FORMAT:'Choose a supported format name',
 NOT_STRING:'Enter a text value',
 VALUE_TOO_LONG:'Value exceeds the 4,096-character limit',
 INVALID_FORMAT:'Value does not match the selected format',
 INVALID_ITEM:'Each batch item must contain format and value',
 INVALID_ROW:'CSV row has a different number of columns than the header',
 ACCESSOR_PROPERTY:'Input includes a getter which cannot be safely inspected',
 INSPECTION_FAILED:'Input cannot be safely inspected'
});
const descriptionsKo=Object.freeze({
 OK:'선택한 형식에 일치합니다',
 UNSUPPORTED_FORMAT:'지원되는 형식을 선택하세요',
 NOT_STRING:'문자열을 입력하세요',
 VALUE_TOO_LONG:'문자열이 4,096자 제한을 초과했습니다',
 INVALID_FORMAT:'선택한 형식에 일치하지 않습니다',
 INVALID_ITEM:'배치 항목에는 format과 value가 있어야 합니다',
 INVALID_ROW:'CSV 행의 열 개수가 머리글과 다릅니다',
 ACCESSOR_PROPERTY:'getter 속성은 안전하게 검사할 수 없습니다',
 INSPECTION_FAILED:'입력값을 안전하게 검사하지 못했습니다'
});
const hostname=s=>s.length>0&&s.length<=253&&s.split('.').every(x=>x.length>0&&x.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(x));
function email(s){
 const at=s.lastIndexOf('@');
 if(s.length>254||at<1||at>64||s.indexOf('@')!==at)return false;
 const local=s.slice(0,at),domain=s.slice(at+1);
 return !local.startsWith('.')&&!local.endsWith('.')&&!local.includes('..')&&/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+$/.test(local)&&domain.includes('.')&&hostname(domain);
}
function ipv4(v){const a=v.split('.');return a.length===4&&a.every(x=>/^(0|[1-9][0-9]{0,2})$/.test(x)&&Number(x)<=255);}
function ipv6(v){
 if(!/^[0-9a-f:.]+$/i.test(v))return false;
 try {const u=new URL('http://['+v+']/');return u.hostname.startsWith('[')&&u.hostname.endsWith(']');}catch{return false;}
}
function date(v){
 const m=/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(v);if(!m)return false;
 const y=Number(m[1]),mon=Number(m[2]),day=Number(m[3]);
 if(y<1||mon<1||mon>12)return false;
 const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return day>=1&&day<=days[mon-1];
}
function uri(v){
 if(!/^https?:\/\/[^/?#]+/i.test(v)||/[\s\\\u0000-\u001f\u007f]/.test(v))return false;
 const authority=v.slice(v.indexOf('://')+3).split(/[/?#]/,1)[0];
 if(authority.includes('@'))return false;
 try {const u=new URL(v);return (u.protocol==='http:'||u.protocol==='https:')&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
}
const validators=Object.freeze({
 email,hostname,ipv4,ipv6,
 uuid:v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
 date,time:v=>/^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,3})?)?$/.test(v),uri
});
export function inspectFormat(format,value){
 if(typeof format!=='string'||!Object.hasOwn(validators,format))return {valid:false,code:'UNSUPPORTED_FORMAT'};
 if(typeof value!=='string')return {valid:false,code:'NOT_STRING'};
 if(value.length>4096)return {valid:false,code:'VALUE_TOO_LONG'};
 try {return validators[format](value)?{valid:true,code:'OK'}:{valid:false,code:'INVALID_FORMAT'};}catch{return {valid:false,code:'INSPECTION_FAILED'};}
}
export function explainResult(result,locale='en'){
 if(locale!=='en'&&locale!=='ko')throw new RangeError('unsupported locale');
 const table=locale==='ko'?descriptionsKo:descriptions;
 return table[result?.code]??(locale==='ko'?'알 수 없는 검사 결과입니다':'Unrecognized result');
}
export function inspectBatch(input,{maxItems=100}={}){
 if(!Array.isArray(input))throw new TypeError('batch must be an array');
 if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>1000)throw new RangeError('invalid batch size');
 if(input.length>maxItems)throw new RangeError('batch too large');
 const results=[];
 for(let index=0;index<input.length;index++){
  let r;
  try {
   const itemD=Object.getOwnPropertyDescriptor(input,String(index));
   if(itemD&&!Object.hasOwn(itemD,'value'))r={valid:false,code:'ACCESSOR_PROPERTY'};
   else {
    const item=itemD?.value;
    if(!item||typeof item!=='object'||Array.isArray(item))r={valid:false,code:'INVALID_ITEM'};
    else {
     const fmt=Object.getOwnPropertyDescriptor(item,'format'),val=Object.getOwnPropertyDescriptor(item,'value');
     if((fmt&&!Object.hasOwn(fmt,'value'))||(val&&!Object.hasOwn(val,'value')))r={valid:false,code:'ACCESSOR_PROPERTY'};
     else r=inspectFormat(fmt?.value,val?.value);
    }
   }
  }catch{r={valid:false,code:'INSPECTION_FAILED'};}
  results.push({index,...r});
 }
 return results;
}
export function inspectJson(text){
 if(typeof text!=='string'||text.length>LIMIT||new TextEncoder().encode(text).length>LIMIT)throw new RangeError('JSON input too large');
 const parsed=JSON.parse(text);if(!Array.isArray(parsed))throw new TypeError('JSON input must be an array');
 return inspectBatch(parsed);
}

export function inspectCsv(text){
 const rows=csvRows(text);
 if(rows.length<2)throw new TypeError('CSV must include header and records');
 const header=rows.shift();
 if(header.length!==2||new Set(header).size!==2||!header.includes('format')||!header.includes('value'))throw new TypeError('CSV header must be format,value');
 if(rows.length>100)throw new RangeError('CSV batch too large');
 const fmtIndex=header.indexOf('format'),valueIndex=header.indexOf('value');
 const records=rows.map(row=>{
  if(row.length!==2)return null;
  return {format:row[fmtIndex],value:row[valueIndex]};
 });
 return inspectBatch(records);
}

/**
 * Audit an ordinary multi-column CSV with an explicit column-to-format mapping.
 * Returns only row, column, and validation codes, never submitted field values.
 */
export function inspectTableCsv(text,formats){
 const rows=csvRows(text);
 if(rows.length<2)throw new TypeError('CSV table must include header and records');
 const header=rows.shift();
 if(header.length<1||header.length>100||new Set(header).size!==header.length||header.some(h=>!h||h.length>128))throw new TypeError('invalid CSV header');
 if(!formats||typeof formats!=='object'||Array.isArray(formats))throw new TypeError('expected format mapping');
 const proto=Object.getPrototypeOf(formats);
 if(proto!==Object.prototype&&proto!==null)throw new TypeError('invalid format mapping');
 const properties=Reflect.ownKeys(formats);
 if(!properties.length||properties.length>20||properties.some(x=>typeof x!=='string'||!x||x.length>128))throw new TypeError('invalid format mapping');
 const checks=[];
 for(const column of properties){
  const desc=Object.getOwnPropertyDescriptor(formats,column);
  if(!desc||!Object.hasOwn(desc,'value')||typeof desc.value!=='string'||!Object.hasOwn(validators,desc.value))throw new TypeError('unsupported mapping format');
  const index=header.indexOf(column);
  if(index===-1)throw new TypeError('mapped column missing in CSV header');
  checks.push({column,index,format:desc.value});
 }
 const results=[];let passed=0;
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(row.length!==header.length){results.push({row:i+1,column:null,valid:false,code:'INVALID_ROW'});continue;}
  for(const check of checks){
   const result=inspectFormat(check.format,row[check.index]);
   results.push({row:i+1,column:check.column,...result});
   if(result.valid)passed++;
  }
 }
 return {rows:rows.length,checks:results.length,passed,failed:results.length-passed,valid:passed===results.length,results};
}
