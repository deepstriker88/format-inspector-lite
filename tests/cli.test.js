import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../bin/cli.js',import.meta.url).pathname;
const run=(args=[],input='')=>spawnSync(process.execPath,[cli,...args],{input,encoding:'utf8',timeout:3000});
test('CLI validates JSON batch from stdin',()=>{
 const r=run([],'[{"format":"email","value":"x@example.com"}]');
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout)[0].code,'OK');
});
test('CLI signals validation failure with distinct exit code',()=>{
 const r=run([],'[{"format":"date","value":"2023-02-29"}]');
 assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout)[0].code,'INVALID_FORMAT');
});
test('CLI supports JSONL input and CSV output',()=>{
 const r=run(['--jsonl','--format','csv'],'{"format":"email","value":"a@b.com"}\n{"format":"email","value":"bad"}\n');
 assert.equal(r.status,1);assert.match(r.stdout,/"0","true","OK"/);assert.match(r.stdout,/"1","false","INVALID_FORMAT"/);
});
test('CLI handles JSONL output and preserves indices',()=>{
 const r=run(['--jsonl','--format','jsonl'],'{"format":"uuid","value":"bad"}\n');
 assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout.trim()).index,0);
});
test('CLI reads input file and supports local offline use',()=>{
 const dir=mkdtempSync(join(tmpdir(),'format-cli-'));
 try{const file=join(dir,'data.json');writeFileSync(file,'[{"format":"ipv4","value":"127.0.0.1"}]');const r=run(['--input',file]);assert.equal(r.status,0,r.stderr);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI malformed or empty input is an input error',()=>{
 for(const x of ['[]','{}','invalid json']){const r=run([],x);assert.equal(r.status,2,x);assert.equal(r.stdout,'');}
});
test('CLI rejects oversized batches and unknown flags',()=>{
 const r=run([],JSON.stringify(Array.from({length:101},()=>({format:'date',value:'2024-02-29'}))));
 assert.equal(r.status,2);
 assert.equal(run(['--unknown'],'[]').status,2);
});
test('CLI help is available without input',()=>{
 const r=run(['--help']);assert.equal(r.status,0);assert.match(r.stdout,/Usage:/);
});
test('CLI reads CSV and exports JSON without a network dependency',()=>{
 const r=run(['--csv','--format','json'],'format,value\nemail,x@example.com\nemail,invalid\n');
 assert.equal(r.status,1);const rows=JSON.parse(r.stdout);assert.equal(rows[0].valid,true);assert.equal(rows[1].code,'INVALID_FORMAT');
});
test('CLI refuses mutually exclusive input formats',()=>{
 const r=run(['--csv','--jsonl'],'format,value\nemail,x@example.com\n');assert.equal(r.status,2);
});
test('CLI audits arbitrary CSV columns against a local mapping file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'format-rules-'));
 try{
  const mapping=join(dir,'rules.json');writeFileSync(mapping,JSON.stringify({email:'email',joined:'date'}));
  const input='name,email,joined\nAlice,a@example.com,2024-02-29\nBob,invalid,2023-02-29\n';
  const r=run(['--table-rules',mapping,'--format','csv'],input);
  assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/"row","column","valid","code","explanation"/);
  assert.match(r.stdout,/"2","email","false","INVALID_FORMAT"/);
  assert.match(r.stdout,/"2","joined","false","INVALID_FORMAT"/);
  assert.doesNotMatch(r.stdout,/Alice|Bob|a@example.com|2023-02-29/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI table audit JSON includes per-column outcomes and counts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'format-rules-'));
 try{
  const mapping=join(dir,'rules.json');writeFileSync(mapping,'{"email":"email"}');
  const r=run(['--table-rules',mapping],'email,name\nx@example.com,X\n');
  assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout);
  assert.equal(data.rows,1);assert.equal(data.passed,1);assert.equal(data.results[0].column,'email');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI fails closed when mapping contains unsupported format',()=>{
 const dir=mkdtempSync(join(tmpdir(),'format-rules-'));
 try{
  const mapping=join(dir,'rules.json');writeFileSync(mapping,'{"email":"not-a-format"}');
  const r=run(['--table-rules',mapping],'email\nx@example.com\n');
  assert.equal(r.status,2);assert.equal(r.stdout,'');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI does not permit CSV mapping with NDJSON mode',()=>{
 const r=run(['--jsonl','--table-rules','rules.json'],'{}\n');assert.equal(r.status,2);
});
test('CLI neutralizes formula-like untrusted CSV headers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'format-formula-'));
 try{
  const mapping=join(dir,'mapping.json');writeFileSync(mapping,JSON.stringify({'=1+2':'email'}));
  const r=run(['--table-rules',mapping,'--format','csv'],'=1+2\na@example.com\n');
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/'=1\+2/);
  assert.doesNotMatch(r.stdout,/^"1","=1\+2"/m);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI summary reports error counts and columns without input values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'table-summary-'));
 try{
  const rules=join(dir,'rules.json');writeFileSync(rules,'{"email":"email","joined":"date"}');
  const input='name,email,joined\nAlice,a@example.com,2024-02-29\nBob,bad,2023-02-29\n';
  const r=run(['--table-rules',rules,'--summary'],input);
  assert.equal(r.status,1,r.stderr);const data=JSON.parse(r.stdout);
  assert.equal(data.rows,2);assert.equal(data.failed,2);
  assert.ok(data.columns.some(x=>x.column==='email'));assert.ok(data.issues.some(x=>x.column==='joined'));
  assert.doesNotMatch(r.stdout,/Alice|Bob|a@example.com/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI summary CSV output exports safe aggregate columns',()=>{
 const dir=mkdtempSync(join(tmpdir(),'table-summary-'));
 try{
  const rules=join(dir,'rules.json');writeFileSync(rules,'{"email":"email"}');
  const r=run(['--table-rules',rules,'--summary','--format','csv'],'email\nbad\n');
  assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/"column","code","failures","percentOfRows","exampleRows","message"/);
  assert.match(r.stdout,/"email","INVALID_FORMAT","1","100"/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI summary requires a mapping and denies NDJSON output',()=>{
 assert.equal(run(['--summary'],'[]').status,2);
 assert.equal(run(['--summary','--table-rules','rules.json','--format','jsonl'],'[]').status,2);
});
test('CLI rejects invalid UTF-8 bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'invalid-utf8-'));
 try{const file=join(dir,'bad.json');writeFileSync(file,Buffer.from([0xff,0xfe]));const r=run(['--input',file]);assert.equal(r.status,2);assert.equal(r.stdout,'');}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI accepts UTF-8 BOM in JSON files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bom-utf8-'));
 try{const file=join(dir,'bom.json');writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('[{"format":"email","value":"a@b.com"}]')]));const r=run(['--input',file]);assert.equal(r.status,0,r.stderr);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI detects possible formats across input strings',()=>{
 const input=JSON.stringify(['a@b.com','127.0.0.1','not a format!']);
 const r=run(['--detect'],input);
 assert.equal(r.status,1,r.stderr);const result=JSON.parse(r.stdout);
 assert.equal(result.count,3);assert.equal(result.matched,2);assert.equal(result.unmatched,1);
 assert.deepEqual(result.results[0].matches,['email']);
 assert.equal(result.results[1].ambiguous,true);assert.ok(result.results[1].matches.includes('ipv4'));
 assert.doesNotMatch(r.stdout,/not a format!/);
});
test('CLI detect exports only classified formats, not sensitive input',()=>{
 const r=run(['--detect','--format','csv'],JSON.stringify(['a@b.com','private!data']));
 assert.equal(r.status,1);assert.match(r.stdout,/"index","matched","ambiguous","matches","code"/);
 assert.match(r.stdout,/"0","true","false","email","OK"/);
 assert.doesNotMatch(r.stdout,/private!data|a@b.com/);
});
test('CLI detect supports JSONL string records',()=>{
 const r=run(['--detect','--jsonl','--format','jsonl'],'"a@b.com"\n"2024-02-29"\n');
 assert.equal(r.status,0,r.stderr);const rows=r.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,2);assert.equal(rows[1].matched,true);
});
test('CLI detect rejects incompatible modes and empty samples',()=>{
 assert.equal(run(['--detect','--csv'],'[]').status,2);
 assert.equal(run(['--detect','--summary'],'[]').status,2);
 assert.equal(run(['--detect'],'[]').status,2);
});
test('CLI exports localized CSV explanations in Korean',()=>{
 const r=run(['--format','csv','--locale','ko'],'[{"format":"email","value":"not-an-email"}]');
 assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/일치하지 않습니다/);
});
test('CLI refuses unsupported locale',()=>assert.equal(run(['--locale','fr'],'[]').status,2));
