import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('comparison workspace uses actual core and produces actionable redacted reports',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'review-test-'));
 try{
  await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
  const source=await readFile(new URL('../public/review.js',import.meta.url),'utf8');
  await writeFile(path.join(dir,'review.js'),source);
  await writeFile(path.join(dir,'index.js'),await readFile(new URL('../../src/index.js',import.meta.url)));
  await writeFile(path.join(dir,'strict-json.js'),await readFile(new URL('../../src/strict-json.js',import.meta.url)));
  await writeFile(path.join(dir,'contract.js'),await readFile(new URL('../../src/contract.js',import.meta.url)));
  await writeFile(path.join(dir,'csv.js'),await readFile(new URL('../../src/csv.js',import.meta.url)));
  const {check,describe}=await import(pathToFileURL(path.join(dir,'review.js')));
  const rules=JSON.stringify({version:1,columns:[{name:'id',required:true,unique:true},{name:'email',format:'email'}]});
  const previous='id,email\n1,one@example.com\n2,two@example.com';
  const current='id,email\n1,PRIVATE_BAD\n1,two@example.com';
  const report=check({rules,previous,current});
  assert.equal(report.delta.invalidRows,2);
  assert.equal(report.delta.invalidRatePercentagePoints,100);
  assert.equal(describe(report).state,'fail');
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_BAD|two@example/);
  assert.equal(describe(check({rules,previous,current:previous})).state,'pass');
  assert.equal(describe(check({rules,previous:'other\n1',current:previous})).state,'incomparable');
  assert.throws(()=>check({rules,previous,current:'x'.repeat(1048577)}),RangeError);
 }finally{await rm(dir,{recursive:true,force:true});}
});
