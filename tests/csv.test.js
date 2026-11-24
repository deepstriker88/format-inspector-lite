import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCsv} from '../src/index.js';
test('CSV imports standard format,value rows',()=>{
 const rows=inspectCsv('format,value\nemail,user@example.com\ndate,2023-02-29\n');
 assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.code),['OK','INVALID_FORMAT']);
});
test('CSV import supports reversed headers, BOM, and CRLF',()=>{
 const rows=inspectCsv('\uFEFFvalue,format\r\n127.0.0.1,ipv4\r\n2024-02-29,date\r\n');
 assert.equal(rows.length,2);assert.equal(rows[0].valid,true);assert.equal(rows[1].valid,true);
});
test('quoted commas, escaped quotes and multiline fields stay in one record',()=>{
 const rows=inspectCsv('format,value\nemail,"first,last@example.com"\ndate,"2024-01-01\ntext"\nuuid,"bad""id"\n');
 assert.equal(rows.length,3);assert.deepEqual(rows.map(x=>x.code),['INVALID_FORMAT','INVALID_FORMAT','INVALID_FORMAT']);
});
test('CSV header must be exact and non-duplicated',()=>{
 for(const s of ['format,format\nemail,a@b.com','format,wrong\nemail,a@b.com','format\nemail'])assert.throws(()=>inspectCsv(s),TypeError);
});
test('CSV rejects unterminated quote and extra quote text',()=>{
 for(const s of ['format,value\nemail,"unterminated','format,value\nemail,"closed"text','format,value\nemail,ab"cd'])assert.throws(()=>inspectCsv(s),SyntaxError);
});
test('CSV rows with missing or excess columns are flagged, not skipped',()=>{
 const rows=inspectCsv('format,value\nemail\ndate,2024-02-29,extra\n');
 assert.deepEqual(rows.map(x=>x.code),['INVALID_ITEM','INVALID_ITEM']);
});
test('CSV enforces 100 records and input byte size',()=>{
 assert.throws(()=>inspectCsv('format,value\n'+Array(101).fill('email,a@b.com').join('\n')),RangeError);
 assert.throws(()=>inspectCsv('format,value\n'+ 'ü'.repeat(524290)),RangeError);
});
test('empty CSV cannot be treated as valid input',()=>{
 assert.throws(()=>inspectCsv(''),TypeError);
 assert.throws(()=>inspectCsv('format,value\n'),TypeError);
});
