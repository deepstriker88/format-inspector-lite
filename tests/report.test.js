import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTableCsv,summarizeTableResults} from '../src/report.js';
import {inspectTableCsv} from '../src/index.js';
const csv='name,email,joined\nAlice,a@example.com,2024-02-29\nBob,broken,2023-02-29\nCarol,c@example.com,2023-02-29\n';
const formats={email:'email',joined:'date'};
test('aggregates failures by mapped column and error code',()=>{
 const report=summarizeTableCsv(csv,formats);
 assert.deepEqual([report.rows,report.checks,report.passed,report.failed],[3,6,3,3]);
 assert.deepEqual(report.columns.map(x=>x.column),['email','joined']);
 assert.equal(report.issues[0].column,'joined');assert.equal(report.issues[0].failures,2);
 assert.deepEqual(report.issues[0].exampleRows,[2,3]);assert.equal(report.issues[0].percentOfRows,66.67);
 assert.equal(report.columns.find(x=>x.column==='email').failureRatePercent,33.33);
});
test('summarizer accepts an existing raw table result without rescanning data',()=>{
 const report=inspectTableCsv(csv,formats);
 assert.deepEqual(summarizeTableResults(report),summarizeTableCsv(csv,formats));
});
test('report contains no submitted raw values or names',()=>{
 const sensitive='super-secret-customer-value';
 const report=summarizeTableCsv('email\n'+sensitive+'\n',{email:'email'});
 assert.doesNotMatch(JSON.stringify(report),new RegExp(sensitive));
});
test('fully valid tables have zero issues and a zero failure rate',()=>{
 const report=summarizeTableCsv('email\na@example.com\nb@example.com\n',{email:'email'});
 assert.equal(report.failed,0);assert.deepEqual(report.issues,[]);
 assert.equal(report.columns[0].failureRatePercent,0);
});
test('malformed CSV row is grouped separately from individual field failures',()=>{
 const report=summarizeTableCsv('email,date\na@example.com,2024-02-29\nx@example.com\n',{email:'email',date:'date'});
 assert.equal(report.issues.length,1);assert.equal(report.issues[0].code,'INVALID_ROW');assert.equal(report.issues[0].column,'(row)');
});
test('report rows cap applies before aggregation',()=>{
 const text='email\n'+Array(101).fill('x@example.com').join('\n');
 assert.throws(()=>summarizeTableCsv(text,{email:'email'}),RangeError);
});
test('bad report shape is rejected',()=>{
 for(const input of [null,{}, {rows:-1,results:[]}, {rows:0,results:[{row:1,column:'x'}]}])assert.throws(()=>summarizeTableResults(input),TypeError);
});
test('issue example list is bounded to five while preserving total failure count',()=>{
 const text='email\n'+Array(20).fill('bad').join('\n');
 const report=summarizeTableCsv(text,{email:'email'});
 assert.equal(report.issues[0].failures,20);assert.deepEqual(report.issues[0].exampleRows,[1,2,3,4,5]);
});
test('Korean summary messages are available without exposing values',()=>{
 const report=summarizeTableCsv('email\nbad\n',{email:'email'},{locale:'ko'});
 assert.match(report.issues[0].message,/일치하지 않습니다/);
 assert.throws(()=>summarizeTableCsv('email\nbad\n',{email:'email'},{locale:'de'}),RangeError);
});
