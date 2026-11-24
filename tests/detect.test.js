import test from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_FORMATS,detectFormat,detectBatch} from '../src/detect.js';
test('detects all matching formats without selecting one arbitrarily',()=>{
 const r=detectFormat('127.0.0.1');
 assert.equal(r.matched,true);assert.equal(r.ambiguous,true);
 assert.ok(r.matches.includes('ipv4'));assert.ok(r.matches.includes('hostname'));
});
test('detects email and calendar date independently',()=>{
 assert.deepEqual(detectFormat('a@b.com').matches,['email']);
 assert.ok(detectFormat('2024-02-29').matches.includes('date'));
 assert.equal(detectFormat('2024-02-29').ambiguous,true);
 assert.equal(detectFormat('2023-02-29').matches.includes('date'),false);
});
test('candidate list limits classification and preserves order',()=>{
 const r=detectFormat('127.0.0.1',{candidates:['ipv4','hostname']});
 assert.deepEqual(r.matches,['ipv4','hostname']);
 const x=detectFormat('127.0.0.1',{candidates:['email','date']});
 assert.equal(x.matched,false);assert.equal(x.code,'NO_MATCH');
});
test('bad candidate definitions cannot silently weaken checks',()=>{
 for(const c of [[],['email','email'],['unsupported'],Array(9).fill('email')])assert.throws(()=>detectFormat('a@b.com',{candidates:c}),TypeError);
});
test('candidate getter is rejected without execution',()=>{
 let calls=0;const values=['email'];Object.defineProperty(values,'0',{get(){calls++;throw Error('executed')}});
 assert.throws(()=>detectFormat('a@b.com',{candidates:values}),TypeError);assert.equal(calls,0);
});
test('batch excludes raw submitted values from outputs',()=>{
 const sensitive='private!value';
 const result=detectBatch(['a@b.com',sensitive,'2024-02-29']);
 assert.equal(result.count,3);assert.equal(result.matched,2);
 assert.equal(result.results[0].index,0);
 assert.doesNotMatch(JSON.stringify(result),new RegExp(sensitive));
});
test('batch rejects accessor slots without calling getter',()=>{
 let calls=0;const vals=['a@b.com'];Object.defineProperty(vals,'0',{get(){calls++;throw Error('getter')}});
 const report=detectBatch(vals);
 assert.equal(report.results[0].code,'ACCESSOR_PROPERTY');assert.equal(calls,0);
});
test('batch sizes and candidate caps are bounded',()=>{
 assert.throws(()=>detectBatch(Array(101).fill('a@b.com')),RangeError);
 assert.throws(()=>detectBatch([], {maxItems:0}),RangeError);
 assert.throws(()=>detectBatch({},{}),TypeError);
 assert.equal(SUPPORTED_FORMATS.length,8);
});
test('non-strings and overly long strings are not classified',()=>{
 assert.equal(detectFormat(42).code,'NOT_STRING');
 assert.equal(detectFormat('a'.repeat(4097)).code,'VALUE_TOO_LONG');
});
