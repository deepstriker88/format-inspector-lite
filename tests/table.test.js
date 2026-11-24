import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTableCsv} from '../src/index.js';
test('audit multiple CSV columns while preserving original row numbers',()=>{
 const csv='customer,mail,registered\nA,a@example.com,2024-02-29\nB,not-email,2023-02-29\n';
 const report=inspectTableCsv(csv,{mail:'email',registered:'date'});
 assert.deepEqual([report.rows,report.checks,report.passed,report.failed],[2,4,2,2]);
 assert.equal(report.results[0].row,1);assert.equal(report.results[0].column,'mail');
 assert.equal(report.results[2].row,2);assert.equal(report.results[2].code,'INVALID_FORMAT');
 assert.doesNotMatch(JSON.stringify(report),/A,|not-email|a@example.com/);
});
test('audit quoted CSV content using shared RFC parser',()=>{
 const csv='name,email,date\n"Smith, J",j@example.com,2024-02-29\n';
 const r=inspectTableCsv(csv,{email:'email',date:'date'});
 assert.equal(r.valid,true);assert.equal(r.checks,2);
});
test('unknown mapped columns fail rather than silently being ignored',()=>{
 assert.throws(()=>inspectTableCsv('email,date\na@example.com,2024-02-29',{created:'date'}),TypeError);
});
test('unsupported format mapping fails closed before inspecting data',()=>{
 assert.throws(()=>inspectTableCsv('email\na@example.com',{email:'anything'}),TypeError);
});
test('mismatched column count is an INVALID_ROW result',()=>{
 const r=inspectTableCsv('email,date\nx@example.com,2024-02-29\ny@example.com\n',{email:'email'});
 assert.equal(r.failed,1);assert.deepEqual(r.results.at(-1),{row:2,column:null,valid:false,code:'INVALID_ROW'});
});
test('mapping must be a plain data object without executing getters',()=>{
 let count=0;const rules={};Object.defineProperty(rules,'email',{enumerable:true,get(){count++;throw Error('executed')}});
 assert.throws(()=>inspectTableCsv('email\na@example.com',rules),TypeError);
 assert.equal(count,0);
 assert.throws(()=>inspectTableCsv('email\na@example.com',new Map([['email','email']])),TypeError);
});
test('CSV table header cannot contain duplicate column names',()=>{
 assert.throws(()=>inspectTableCsv('email,email\na@example.com,b@example.com',{email:'email'}),TypeError);
});
test('format count is limited for bounded processing cost',()=>{
 const mapping=Object.fromEntries(Array.from({length:21},(_,i)=>['x'+i,'email']));
 assert.throws(()=>inspectTableCsv('email\na@example.com',mapping),TypeError);
});
test('table parser accepts BOM, CRLF and quoted newline',()=>{
 const csv='\uFEFFname,email\r\n"two\nlines",a@example.com\r\n';
 assert.equal(inspectTableCsv(csv,{email:'email'}).valid,true);
});
test('empty CSV table is not treated as success',()=>{
 assert.throws(()=>inspectTableCsv('name,email\n',{email:'email'}),TypeError);
});
