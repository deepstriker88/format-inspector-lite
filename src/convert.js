// Bounded local record conversion. No transport, persistence, or automatic
// type inference. Validation completes before any output is returned.
import {csvRows} from './csv.js';
import {strictJson} from './strict-json.js';
const MAX_INPUT=65536,MAX_OUTPUT=262144,MAX_ROWS=100,MAX_COLUMNS=32;
const encoder=new TextEncoder();
const blocked=new Set(['__proto__','constructor','prototype']);
function bounded(s,max=MAX_INPUT){
 if(typeof s!=='string'||s.length>max||encoder.encode(s).length>max)throw new RangeError('Input or output exceeds limit');
}
function isRecord(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function headers(names){
 if(!Array.isArray(names)||!names.length||names.length>MAX_COLUMNS)throw new RangeError('Column count');
 const seen=new Set();
 for(let i=0;i<names.length;i++){
  const name=names[i];
  if(typeof name!=='string'||!name.trim()||name.length>128||blocked.has(name)||seen.has(name)||/[\u0000-\u001f\u007f]/u.test(name)||!wellFormed(name))throw new TypeError('Invalid or duplicate header at column '+(i+1));
  seen.add(name);
 }
 return names;
}
function wellFormed(s){
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const next=s.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}
 return true;
}
function output(text,extension,rowCount,columnCount){
 bounded(text,MAX_OUTPUT);
 return {converted:true,valid:true,extension,rowCount,columnCount,text};
}
function integer(s,row,col){
 if(!/^-?(?:0|[1-9][0-9]*)$/.test(s)||s==='-0'||!Number.isSafeInteger(Number(s)))throw new TypeError('Invalid safe integer at row '+row+', column '+col);
 return Number(s);
}
export function csvToRecords(text,profileText=''){
 bounded(text);
 const rows=csvRows(text,{maxRows:MAX_ROWS,maxColumns:MAX_COLUMNS});
 const names=headers(rows.shift());
 if(!rows.length)throw new TypeError('At least one data record required');
 // Optional integer-column list only. Every other value stays text.
 const ints=new Set();
 if(profileText!==''){
  bounded(profileText,4096);
  const profile=strictJson(profileText,{maxBytes:4096,maxNodes:200});
  if(!Array.isArray(profile)||profile.length>MAX_COLUMNS||profile.some(x=>typeof x!=='string'||!names.includes(x))||new Set(profile).size!==profile.length)throw new TypeError('Invalid integer-column list');
  for(const name of profile)ints.add(name);
 }
 const records=rows.map((row,i)=>{
  if(row.length!==names.length)throw new TypeError('Column count mismatch at data row '+(i+1));
  const record=Object.create(null);
  for(let j=0;j<row.length;j++){
   if(!wellFormed(row[j]))throw new TypeError('Invalid text at row '+(i+1)+', column '+(j+1));
   record[names[j]]=ints.has(names[j])?integer(row[j],i+1,j+1):row[j];
  }
  return record;
 });
 return output(JSON.stringify(records,null,2)+'\n','json',records.length,names.length);
}
function quote(s,row,col){
 if(!wellFormed(s)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s))throw new TypeError('Unsupported text at row '+row+', column '+col);
 // CSV quoting alone is not a spreadsheet formula-injection defense.
 // Refuse risky text instead of silently altering cell data.
 if(/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(s)||/^[\t\r\n]/u.test(s))throw new TypeError('Formula-like text at row '+row+', column '+col);
 return '"'+s.replaceAll('"','""')+'"';
}
function pointerParts(p){
 if(typeof p!=='string'||p.length>512||!p.startsWith('/')||/~(?![01])/u.test(p))throw new TypeError('Invalid mapping pointer');
 const parts=p.slice(1).split('/').map(v=>v.replaceAll('~1','/').replaceAll('~0','~'));
 if(parts.length>16||parts.some(v=>blocked.has(v)))throw new TypeError('Unsupported mapping pointer');
 return parts;
}
function pointerValue(value,parts,row,col){
 for(const part of parts){
  if(!value||typeof value!=='object'||(Array.isArray(value)&&!/^(0|[1-9][0-9]*)$/.test(part))||!Object.hasOwn(value,part))throw new TypeError('Missing field at row '+row+', column '+col);
  value=value[part];
 }
 return value;
}
export function recordsToCsv(text,profileText=''){
 bounded(text);
 const records=strictJson(text,{maxBytes:MAX_INPUT,maxNodes:20000,integerLexemesOnly:true});
 if(!Array.isArray(records)||!records.length||records.length>MAX_ROWS||records.some(v=>!isRecord(v)))throw new TypeError('Expected 1–100 JSON objects');
 let names,paths=null;
 if(profileText!==''){
  bounded(profileText,4096);
  const pairs=strictJson(profileText,{maxBytes:4096,maxNodes:200});
  if(!Array.isArray(pairs)||!pairs.length||pairs.length>MAX_COLUMNS||pairs.some(v=>!Array.isArray(v)||v.length!==2))throw new TypeError('Invalid ordered mapping');
  names=headers(pairs.map(v=>v[0]));paths=pairs.map(v=>pointerParts(v[1]));
 }else names=headers(Object.keys(records[0]));
 const lines=[names.map((n,j)=>quote(n,0,j+1)).join(',')];
 for(let i=0;i<records.length;i++){
  const record=records[i],row=i+1;
  if(!paths&&(Object.keys(record).length!==names.length||names.some(n=>!Object.hasOwn(record,n))))throw new TypeError('Exact columns differ at data row '+row);
  const values=names.map((name,j)=>{
   const v=paths?pointerValue(record,paths[j],row,j+1):record[name];
   // Strict text default. Explicit mapping additionally permits boolean and
   // safe integer fields. Null, fractional numbers and objects are ambiguous.
   if(paths&&typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0))return '"'+String(v)+'"';
   if(paths&&typeof v==='boolean')return '"'+String(v)+'"';
   if(typeof v!=='string')throw new TypeError('Text required at row '+row+', column '+(j+1));
   return quote(v,row,j+1);
  });
  lines.push(values.join(','));
 }
 return output(lines.join('\r\n')+'\r\n','csv',records.length,names.length);
}
