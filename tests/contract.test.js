import test from 'node:test';
import assert from 'node:assert/strict';
import {auditContract,compareContract} from '../src/contract.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const profile=JSON.stringify({version:1,columns:[{name:'id',required:true,unique:true},{name:'email',required:true,format:'email'}]});
const good='id,email\n1,one@example.com\n2,two@example.com';
test('valid import',()=>assert.equal(auditContract(good,profile).valid,true));
test('required and unique and format checks count invalid rows once',()=>{
 const r=auditContract('id,email\n1,SECRET_BAD\n1,\n,ok@example.com',profile);
 assert.equal(r.invalidRows,3);assert.equal(r.valid,false);
 assert.deepEqual(r.issues.map(x=>[x.column,x.code,x.count]),[[1,'DUPLICATE',1],[1,'REQUIRED',1],[2,'FORMAT',1],[2,'REQUIRED',1]]);
 assert.ok(!JSON.stringify(r).includes('SECRET_BAD'));assert.ok(!JSON.stringify(r).includes('ok@example.com'));
});
test('header drift never reports unexpected names or runs misleading checks',()=>{
 const r=auditContract('id,PRIVATE_COLUMN\n1,secret',profile);
 assert.equal(r.header.missing,1);assert.equal(r.header.unexpected,1);
 assert.equal(r.invalidRows,null);assert.equal(r.rowChecksPerformed,false);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_COLUMN'));
});
test('duplicate headers and changed order fail',()=>{
 assert.equal(auditContract('id,id\n1,2',profile).header.duplicateHeaders,1);
 assert.equal(auditContract('email,id\na@example.com,1',profile).header.orderChanged,true);
});
test('quoted multiline fields and BOM supported',()=>{
 const p=JSON.stringify({version:1,columns:[{name:'note',required:true}]});
 assert.equal(auditContract('\uFEFFnote\r\n"hello\r\nworld"',p).valid,true);
});
test('malformed row is not silently ignored',()=>assert.equal(auditContract('id,email\n1',profile).issues[0].code,'ROW_WIDTH'));
test('optional blanks do not fail format or uniqueness',()=>{
 const p=JSON.stringify({version:1,columns:[{name:'email',unique:true,format:'email'}]});
 assert.equal(auditContract('email\n""\n""',p).valid,true);
});
test('comparison reports regression without values',()=>{
 const r=compareContract(good,'id,email\n1,broken\n1,good@example.com',profile);
 assert.equal(r.comparable,true);assert.equal(r.delta.invalidRows,2);assert.equal(r.delta.invalidRatePercentagePoints,100);assert.equal(r.delta.issues.length,2);assert.equal(r.valid,false);
});
test('comparison does not claim equivalent measurements when header fails',()=>{
 const r=compareContract('x,y\na,b',good,profile);
 assert.equal(r.comparable,false);assert.equal(r.delta.issues,null);assert.equal(r.delta.invalidRows,null);
});
test('schema rejects unsupported keys, formats and duplicate names',()=>{
 for(const columns of [[{name:'x',bogus:true}],[{name:'x',format:'bogus'}],[{name:'x'},{name:'x'}],[{name:'x',required:'true'}]]){
  assert.throws(()=>auditContract('x\na',JSON.stringify({version:1,columns})),TypeError);
 }
});
test('bounded rows and columns',()=>{
 assert.equal(auditContract('id,email\n'+Array.from({length:10000},(_,i)=>i+',a@example.com').join('\n'),profile).rows,10000);
 assert.throws(()=>auditContract('id,email\n'+('1,a@example.com\n').repeat(10001),profile),RangeError);
 assert.throws(()=>auditContract(Array(51).fill('x').join(',')+'\na',profile),RangeError);
});
test('examples bounded to five',()=>{
 const r=auditContract('id,email\n'+Array.from({length:20},(_,i)=>i+',bad').join('\n'),profile);
 assert.equal(r.issues[0].count,20);assert.equal(r.issues[0].exampleRows.length,5);
});
test('CLI exit and report semantics',()=>{
 const dir=mkdtempSync(join(tmpdir(),'csv-contract-'));
 try{
  const rules=join(dir,'rules.json'),csv=join(dir,'data.csv');
  writeFileSync(rules,profile);writeFileSync(csv,good);
  const args=['bin/contract.js','--profile',rules,'--input',csv];
  const ok=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(ok.status,0);assert.equal(JSON.parse(ok.stdout).valid,true);
  writeFileSync(csv,'id,email\n1,SECRET_BAD');
  const bad=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(bad.status,1);assert.ok(!bad.stdout.includes('SECRET_BAD'));
  writeFileSync(csv,Buffer.from([255]));
  const err=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(err.status,2);assert.equal(err.stdout,'');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('header-only delivery is rejected rather than marked healthy',()=>{
 assert.throws(()=>auditContract('id,email',profile),TypeError);
});

test('contract profile rejects duplicate decoded keys and non-finite numbers',()=>{
 const ambiguous='{"version":1,"columns":[{"name":"id","required":true,"requ\\u0069red":false}]}';
 assert.throws(()=>auditContract('id\n1',ambiguous),SyntaxError);
 assert.throws(()=>auditContract('id\n1','{"version":1e999,"columns":[{"name":"id"}]}'),RangeError);
 assert.throws(()=>auditContract('id\n1','{"version":1,"columns":'+ '['.repeat(70)+'0'+']'.repeat(70)+'}'),RangeError);
});
test('contract profile accepts valid escaped key and string',()=>{
 const p='{"version":1,"columns":[{"na\\u006de":"a\\"b","required":true}]}';
 assert.equal(auditContract('"a""b"\nx',p).valid,true);
});
