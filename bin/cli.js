#!/usr/bin/env node
import {readFileSync,statSync} from 'node:fs';
import process from 'node:process';
import {inspectBatch,inspectCsv,inspectTableCsv,explainResult} from '../src/index.js';
import {summarizeTableCsv} from '../src/report.js';
import {detectBatch} from '../src/detect.js';
const LIMIT=1048576;
const decodeUTF8=data=>new TextDecoder('utf-8',{fatal:true}).decode(data);
const USAGE='Usage: format-inspector-lite [--input filename] [--jsonl|--csv] [--table-rules rules.json] [--format json|jsonl|csv] [--summary] [--locale en|ko]\n       format-inspector-lite --detect [--input values.json] [--jsonl] [--format json|jsonl|csv]\nReads stdin by default; supports JSON arrays or one JSON record per line.\nExit: 0 all valid, 1 invalid value(s), 2 invalid input.\n';
function argsOf(args){
 const opt={format:'json',locale:'en',jsonl:false,csv:false,summary:false,detect:false},seen=new Set();
 for(let i=0;i<args.length;i++){
  const a=args[i];if(a==='-h'||a==='--help')return {help:true};
  if(a==='--jsonl'||a==='--csv'||a==='--summary'||a==='--detect'){if(seen.has(a))throw Error('duplicate flag');opt[a.slice(2)]=true;seen.add(a);}
  else if(a==='--input'||a==='--format'||a==='--table-rules'||a==='--locale'){
   if(seen.has(a)||!args[i+1]||args[i+1].startsWith('--'))throw Error('missing or duplicate argument');
   seen.add(a);opt[a==='--table-rules'?'tableRules':a.slice(2)]=args[++i];
  }else throw Error('unknown argument');
 }
 if(opt.tableRules&&opt.jsonl)throw Error('--table-rules cannot be combined with --jsonl');
 if(opt.tableRules)opt.csv=true;
 if(opt.jsonl&&opt.csv)throw Error('--jsonl and --csv are mutually exclusive');
 if(opt.summary&&(!opt.tableRules||opt.format==='jsonl'))throw Error('--summary requires --table-rules and json/csv output');
 if(opt.detect&&(opt.tableRules||opt.csv||opt.summary))throw Error('--detect cannot be combined with CSV mapping or summary');
 if(!['json','jsonl','csv'].includes(opt.format))throw Error('unsupported output format');
 if(!['en','ko'].includes(opt.locale))throw Error('unsupported locale');
 return opt;
}
function readFile(path){
 if(statSync(path).size>LIMIT)throw new RangeError('too large');
 const buf=readFileSync(path);if(buf.byteLength>LIMIT)throw new RangeError('too large');
 return decodeUTF8(buf);
}
async function readStdin(){
 let bytes=0;const chunks=[];
 for await(const chunk of process.stdin){const data=typeof chunk==='string'?Buffer.from(chunk):chunk;bytes+=data.byteLength;if(bytes>LIMIT)throw new RangeError('too large');chunks.push(data);}
 return decodeUTF8(Buffer.concat(chunks));
}
// Quote alone is not sufficient: some spreadsheet clients still evaluate CSV formulas.
const quote=x=>{
 const value=String(x??'');
 const safe=/^[\s\uFEFF]*[=+\-@]/.test(value)||/^[\t\r\n]/.test(value)?"'"+value:value;
 return '"'+safe.replaceAll('"','""')+'"';
};
function output(data,format,locale){
 if(format==='json')return JSON.stringify(data,null,2)+'\n';
 if(data.issues){
  const rows=[['column','code','failures','percentOfRows','exampleRows','message'],...data.issues.map(x=>[x.column,x.code,x.failures,x.percentOfRows,x.exampleRows.join(';'),x.message])];
  return rows.map(row=>row.map(quote).join(',')).join('\n')+'\n';
 }
 if(Object.hasOwn(data,'matched')){
  if(format==='jsonl')return data.results.map(row=>JSON.stringify(row)).join('\n')+'\n';
  return [['index','matched','ambiguous','matches','code'],...data.results.map(row=>[row.index,row.matched,row.ambiguous,row.matches.join(';'),row.code])].map(row=>row.map(quote).join(',')).join('\n')+'\n';
 }
 const rows=Array.isArray(data)?data:data.results;
 if(format==='jsonl')return rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
 const isTable=!Array.isArray(data);
 const columns=isTable?['row','column','valid','code','explanation']:['index','valid','code','explanation'];
 const lines=[columns,...rows.map(row=>isTable?[row.row,row.column,row.valid,row.code,explainResult(row,locale)]:[row.index,row.valid,row.code,explainResult(row,locale)])];
 return lines.map(row=>row.map(quote).join(',')).join('\n')+'\n';
}
try{
 const options=argsOf(process.argv.slice(2));
 if(options.help){process.stdout.write(USAGE);}
 else {
  const raw=options.input?readFile(options.input):await readStdin();
  let rows;
  if(options.detect){
   const items=options.jsonl?raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line)):JSON.parse(raw);
   if(!Array.isArray(items)||items.length===0)throw new TypeError('input must be a nonempty array');
   rows=detectBatch(items);
  }else if(options.csv){
   const mapping=options.tableRules?JSON.parse(readFile(options.tableRules)):null;
   rows=options.tableRules?(options.summary?summarizeTableCsv(raw,mapping,{locale:options.locale}):inspectTableCsv(raw,mapping)):inspectCsv(raw);
  }
  else {
   const items=options.jsonl?raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line)):JSON.parse(raw);
   if(!Array.isArray(items)||items.length===0)throw new TypeError('input must be a nonempty array');
   rows=inspectBatch(items);
  }
  process.stdout.write(output(rows,options.format,options.locale));
  if(rows.issues?rows.failed>0:Object.hasOwn(rows,'matched')?rows.unmatched>0:(Array.isArray(rows)?rows:rows.results).some(row=>!row.valid))process.exitCode=1;
 }
}catch(e){
 process.stderr.write('Format Inspector: '+(e instanceof SyntaxError?'invalid JSON input':e instanceof RangeError?'input exceeds policy limit':e instanceof TypeError?'invalid input type':e.message)+'\n');
 process.exitCode=2;
}
