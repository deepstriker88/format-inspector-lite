import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFormat,inspectBatch,inspectJson,explainResult} from '../src/index.js';
test('calendar years and leap day boundaries',()=>{
 for(const d of ['0001-01-01','2000-02-29','2024-02-29','9999-12-31'])assert.equal(inspectFormat('date',d).valid,true,d);
 for(const d of ['0000-01-01','1900-02-29','2023-02-29','2024-04-31','2024-13-01','2024-01-00','2024-01-32'])assert.equal(inspectFormat('date',d).valid,false,d);
});
test('email local parts and host labels',()=>{
 for(const v of ['a..b@example.com','.a@example.com','a.@example.com','a@-example.com','a@exam_ple.com','a@local','a@@example.com','a'.repeat(65)+'@example.com'])assert.equal(inspectFormat('email',v).valid,false,v);
 assert.equal(inspectFormat('email','first.last+tag@example.co.uk').valid,true);
});
test('IPv6 compressed mapped and malformed inputs',()=>{
 for(const x of ['::1','2001:db8::a','::ffff:192.0.2.1'])assert.equal(inspectFormat('ipv6',x).valid,true,x);
 for(const x of ['[::1]','fe80::1%eth0',':::1','::1]@evil.com','2001:::1','::ffff:999.1.1.1'])assert.equal(inspectFormat('ipv6',x).valid,false,x);
});
test('URI rejects whitespace, userinfo, and unsafe normalization',()=>{
 for(const x of ['https://example.com','http://example.com/a?b=1','https://[::1]/'])assert.equal(inspectFormat('uri',x).valid,true,x);
 for(const x of [' https://example.com','http:example.com','https://user:pass@example.com','https://@example.com','file:///tmp','javascript:alert(1)','http://example.com\n'])assert.equal(inspectFormat('uri',x).valid,false,x);
});
test('batch maxItems uses safe integer checks',()=>{
 for(const maxItems of [NaN,Infinity,-1,0,1.5,1001,'100'])assert.throws(()=>inspectBatch([],{maxItems}),RangeError);
 assert.throws(()=>inspectBatch({}),TypeError);
});
test('batch holes and getters are safe',()=>{
 assert.deepEqual(inspectBatch(Array(2)).map(x=>x.code),['INVALID_ITEM','INVALID_ITEM']);
 let calls=0;const item={};Object.defineProperty(item,'format',{get(){calls++;throw Error('getter')}});assert.equal(inspectBatch([item])[0].code,'ACCESSOR_PROPERTY');
 const rows=[null];Object.defineProperty(rows,'0',{get(){calls++;throw Error('getter')}});assert.equal(inspectBatch(rows)[0].code,'ACCESSOR_PROPERTY');assert.equal(calls,0);
});
test('malformed rows and valid records',()=>{
 assert.deepEqual(inspectBatch([null,42,{}, {format:'date',value:'2024-02-29'}]).map(x=>x.code),['INVALID_ITEM','INVALID_ITEM','UNSUPPORTED_FORMAT','OK']);
});
test('format codes have human readable explanations',()=>{
 assert.match(explainResult({code:'INVALID_FORMAT'}),/does not match/);
 assert.match(explainResult({code:'VALUE_TOO_LONG'}),/4,096/);
});
test('JSON size and array structure are enforced',()=>{
 assert.throws(()=>inspectJson('x'.repeat(1024*1024+1)),RangeError);
 assert.throws(()=>inspectJson('{"a":1}'),TypeError);
});
