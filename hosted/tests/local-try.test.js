import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('browser module uses original core; no input transport; bounds',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'local-try-'));
 try {
 const tool=await readFile(new URL('../public/try.js',import.meta.url),'utf8');
 assert.doesNotMatch(tool,/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage)\b/);
 await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
 await writeFile(path.join(dir,'tool.js'),tool);
 await writeFile(path.join(dir,'core.js'),await readFile(new URL('../../src/index.js',import.meta.url)));
 await writeFile(path.join(dir,'strict-json.js'),await readFile(new URL('../../src/strict-json.js',import.meta.url)));
 await writeFile(path.join(dir,'csv.js'),await readFile(new URL('../../src/csv.js',import.meta.url)));
 const {check,readLocalText}=await import(pathToFileURL(path.join(dir,'tool.js')));
 assert.equal(check({mode:'single',format:'email',value:'user@example.com'}).valid,true);
  assert.equal(check({mode:'single',format:'ipv4',value:'999.1.1.1'}).valid,false);
  assert.equal(check({mode:'csv',value:'format,value\nemail,user@example.com'})[0].valid,true);
  assert.equal(check({mode:'json',value:'[{"format":"email","value":"bad"}]'})[0].valid,false);
 assert.throws(()=>check({mode:'json',value:'[]'}),RangeError);
 assert.throws(()=>check({mode:'json',value:'[{"format":"email","value":"bad","value":"good@example.com"}]'}),SyntaxError);
 assert.throws(()=>check({mode:'json',value:'[{"format":"email","value":"bad","\\u0076alue":"good@example.com"}]'}),SyntaxError);
 assert.throws(()=>check({mode:'json',value:'['.repeat(66)+'0'+']'.repeat(66)}),RangeError);
 assert.throws(()=>check({mode:'json',value:'[{"format":"email","value":1e999}]'}),RangeError);
 assert.equal(check({mode:'json',value:'[{"format":"email","value":"user@example.com"},{"format":"email","value":"bad"}]'}).length,2);
 assert.throws(()=>check({value:'x'.repeat(65537),schema:'{}',mode:'single',format:'email'}),RangeError);
 assert.throws(()=>check({value:'한'.repeat(22000),schema:'{}',mode:'single',format:'email'}),RangeError);
 assert.equal(await readLocalText(new Blob(['한글'])), '한글');
 await assert.rejects(()=>readLocalText(new Blob([new Uint8Array([0xff])])),TypeError);
 await assert.rejects(()=>readLocalText({size:65537,arrayBuffer(){throw Error('must not read oversized file');}}),RangeError);
 await assert.rejects(()=>readLocalText({size:1,arrayBuffer:async()=>new ArrayBuffer(2)}),RangeError);
 assert.equal((await readLocalText(new Blob(['x'.repeat(65536)]))).length,65536);
 } finally {await rm(dir,{recursive:true,force:true});}
});
