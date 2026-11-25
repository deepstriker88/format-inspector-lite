// Local CSV import-contract gate. Only counts and numeric positions are reported.
import {csvRows} from './csv.js';
import {strictJson} from './strict-json.js';
import {inspectFormat} from './index.js';
const MAX_ROWS=10000, MAX_COLUMNS=50, MAX_PROFILE_BYTES=16384;
const FORMATS=new Set(['email','hostname','ipv4','ipv6','uuid','date','time','uri']);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function parseProfile(text){
 if(typeof text!=='string'||text.length>MAX_PROFILE_BYTES||new TextEncoder().encode(text).length>MAX_PROFILE_BYTES)throw new RangeError('profile too large');
 const p=strictJson(text,{maxBytes:MAX_PROFILE_BYTES,maxNodes:10000});
 if(!isObject(p)||Object.keys(p).some(k=>!['version','columns'].includes(k))||p.version!==1||!Array.isArray(p.columns)||p.columns.length<1||p.columns.length>MAX_COLUMNS)throw new TypeError('invalid contract');
 const names=new Set();
 for(const c of p.columns){
  if(!isObject(c)||Object.keys(c).some(k=>!['name','required','unique','format'].includes(k))||typeof c.name!=='string'||!c.name.trim()||c.name.length>128||names.has(c.name))throw new TypeError('invalid column rule');
  if(('required' in c&&typeof c.required!=='boolean')||('unique' in c&&typeof c.unique!=='boolean')||('format' in c&&!FORMATS.has(c.format)))throw new TypeError('invalid column rule');
  names.add(c.name);
 }
 return p.columns;
}
function audit(text,rules){
 const rows=csvRows(text,{maxRows:MAX_ROWS,maxColumns:MAX_COLUMNS});
 const header=rows.shift();
 if(rows.length===0)throw new TypeError("CSV must include data rows");
 const names=new Set(header), expected=new Set(rules.map(c=>c.name));
 const missing=rules.filter(c=>!names.has(c.name)).length;
 const unexpected=header.filter(c=>!expected.has(c)).length;
 const duplicateHeaders=header.length-names.size;
 const orderChanged=!missing&&!unexpected&&!duplicateHeaders&&header.some((v,i)=>v!==rules[i].name);
 const headerValid=header.length===rules.length&&!missing&&!unexpected&&!duplicateHeaders&&!orderChanged;
 const issues=new Map(),seen=rules.map(()=>new Set());
 let invalidRows=0;
 const mark=(column,code,row)=>{
  const key=column+':'+code;
  if(!issues.has(key))issues.set(key,{column,code,count:0,exampleRows:[]});
  const item=issues.get(key);item.count++;
  if(item.exampleRows.length<5)item.exampleRows.push(row);
 };
 if(headerValid){
  for(let i=0;i<rows.length;i++){
   const row=rows[i], number=i+1;
   let invalid=false;
   const fail=(column,code)=>{invalid=true;mark(column,code,number);};
   if(row.length!==rules.length){fail(null,'ROW_WIDTH');}
   else for(let j=0;j<rules.length;j++){
    const r=rules[j],v=row[j],blank=!v.trim();
    if(blank){if(r.required)fail(j+1,'REQUIRED');continue;}
    if(r.format&&!inspectFormat(r.format,v).valid)fail(j+1,'FORMAT');
    if(r.unique){if(seen[j].has(v))fail(j+1,'DUPLICATE');else seen[j].add(v);}
   }
   if(invalid)invalidRows++;
  }
 }
 const list=[...issues.values()].sort((a,b)=>(a.column??0)-(b.column??0)||a.code.localeCompare(b.code,'en'));
 return {rows:rows.length,header:{valid:headerValid,missing,unexpected,duplicateHeaders,orderChanged},rowChecksPerformed:headerValid,invalidRows:headerValid?invalidRows:null,issues:list,valid:headerValid&&invalidRows===0};
}
export function auditContract(csv,profile){return audit(csv,parseProfile(profile));}
export function compareContract(previousCsv,currentCsv,profile){
 const rules=parseProfile(profile),previous=audit(previousCsv,rules),current=audit(currentCsv,rules);
 const comparable=previous.rowChecksPerformed&&current.rowChecksPerformed;
 const a=new Map(previous.issues.map(i=>[i.column+':'+i.code,i]));
 const b=new Map(current.issues.map(i=>[i.column+':'+i.code,i]));
 const changes=comparable?[...new Set([...a.keys(),...b.keys()])].map(key=>{
  const before=a.get(key),after=b.get(key),item=after??before;
  return {column:item.column,code:item.code,previous:before?.count??0,current:after?.count??0,delta:(after?.count??0)-(before?.count??0)};
 }).filter(x=>x.delta!==0).sort((a,b)=>(a.column??0)-(b.column??0)||a.code.localeCompare(b.code,'en')):null;
 return {previous,current,comparable,delta:{rows:current.rows-previous.rows,invalidRows:comparable?current.invalidRows-previous.invalidRows:null,invalidRatePercentagePoints:comparable&&previous.rows&&current.rows?Math.round((current.invalidRows/current.rows-previous.invalidRows/previous.rows)*10000)/100:null,issues:changes},valid:current.valid};
}
