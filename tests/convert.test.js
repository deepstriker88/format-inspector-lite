import test from 'node:test';
import assert from 'node:assert/strict';
import {csvToRecords,recordsToCsv} from '../src/convert.js';
test('CSV to JSON preserves leading zeros, quotes, multiline, blanks and Unicode',()=>{
 const input='\uFEFFsku,note,qty\r\n0042,"Tea, ""green""",4\r\n0007,"한글\nsecond line",';
 const actual=JSON.parse(csvToRecords(input).text);
 assert.deepEqual(actual,[{sku:'0042',note:'Tea, "green"',qty:'4'},{sku:'0007',note:'한글\nsecond line',qty:''}]);
 assert.deepEqual(JSON.parse(csvToRecords('sku,qty\n0012,4','["qty"]').text),[{sku:'0012',qty:4}]);
 assert.throws(()=>csvToRecords('sku,qty\n0012,04','["qty"]'));
 assert.throws(()=>csvToRecords('sku,qty\n0012,9007199254740992','["qty"]'));
 assert.throws(()=>csvToRecords('sku,qty\n0012,4','["missing"]'));
});
test('reject duplicate or dangerous headers and missing data before output',()=>{
 for(const text of ['a,a\n1,2','a,\n1,2','__proto__,b\n1,2','a,b\n1','a,b\n1,2,3','a,b','a\n"unterminated'])assert.throws(()=>csvToRecords(text),undefined,text);
});
test('JSON to CSV enforces exact key set, preserves text and escapes quotes',()=>{
 const input='[{"sku":"0042","note":"a, b"},{"note":"x\\ny","sku":"0007"}]';
 const csv=recordsToCsv(input).text;
 assert.equal(csv,'"sku","note"\r\n"0042","a, b"\r\n"0007","x\ny"\r\n');
 assert.deepEqual(JSON.parse(csvToRecords(csv).text),JSON.parse(input));
 for(const x of ['[{"a":"x"},{"a":"y","b":"z"}]','[{"a":"x"},{}]','[{"a":1}]','[{"a":null}]','[{"a":"x","\\u0061":"y"}]','[{"__proto__":"x"}]','[]'])assert.throws(()=>recordsToCsv(x),undefined,x);
});
test('explicit pointer selection allows only strings, booleans and safe integers',()=>{
 const x='[{"ref":17,"team":{"name":"Ops"},"a/b":false,"codes":["0001"]}]';
 assert.equal(recordsToCsv(x,'[["Ticket","/ref"],["Team","/team/name"],["Flag","/a~1b"],["Code","/codes/0"]]').text,'"Ticket","Team","Flag","Code"\r\n"17","Ops","false","0001"\r\n');
 for(const map of ['[["a","/missing"]]','[["a","/codes/length"]]','[["a","/a~2b"]]','[["a","/__proto__"]]','[["a","/ref"],["a","/ref"]]'])assert.throws(()=>recordsToCsv(x,map),undefined,map);
 for(const n of ['1.5','9007199254740990.5','1e0','1.00000000000000001','-0','9007199254740993'])assert.throws(()=>recordsToCsv('[{"n":'+n+'}]','[["n","/n"]]'),undefined,n);
});
test('formula-like cells and unpaired surrogates are not silently exported',()=>{
 for(const value of ['=1+1','  +cmd','-1','@X','＝1+1','\ttext','\uFEFF=1','\ud800'])assert.throws(()=>recordsToCsv(JSON.stringify([{a:value}])),undefined,value);
 assert.throws(()=>recordsToCsv('[{"=key":"ok"}]'));
 assert.equal(recordsToCsv('[{"n":-2}]','[["n","/n"]]').text,'"n"\r\n"-2"\r\n');
 assert.deepEqual(JSON.parse(csvToRecords('a\n=1+1').text),[{a:'=1+1'}]);
});
test('conversion limits',()=>{
 assert.throws(()=>csvToRecords('a\n'+'x'.repeat(65537)),RangeError);
 assert.throws(()=>csvToRecords('a\n'+Array(101).fill('x').join('\n')),RangeError);
 assert.throws(()=>recordsToCsv(JSON.stringify(Array(101).fill({a:'x'}))));
});
