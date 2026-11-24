import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFormat,inspectBatch,inspectJson} from '../src/index.js';
test('formats',()=>{
 for(const [f,v] of [['email','a@b.com'],['hostname','example.com'],['ipv4','127.0.0.1'],['ipv6','::1'],['uuid','123e4567-e89b-42d3-a456-426614174000'],['date','2024-02-29'],['time','23:59:59'],['uri','https://example.com/path']])assert.equal(inspectFormat(f,v).valid,true,f);
});
test('reject invalid',()=>{
 for(const [f,v] of [['email','a@b'],['hostname','-a.com'],['ipv4','999.1.1.1'],['date','2023-02-29'],['time','25:99'],['uri','javascript:alert(1)']])assert.equal(inspectFormat(f,v).valid,false,f);
 assert.equal(inspectFormat('unknown','x').code,'UNSUPPORTED_FORMAT');
 assert.equal(inspectFormat('email',null).code,'NOT_STRING');
});
test('batch and bounds',()=>{
 assert.equal(inspectBatch([{format:'email',value:'a@b.com'}])[0].valid,true);
 assert.throws(()=>inspectBatch(Array(101).fill({})),RangeError);
 assert.throws(()=>inspectJson('{broken'));
 assert.throws(()=>inspectJson('x'.repeat(1024*1024+1)),RangeError);
});

test('browser-safe API and JSON constraints',()=>{
 assert.equal(inspectFormat('ipv4','127.0.0.1').valid,true);
 assert.equal(inspectFormat('ipv4','01.2.3.4').valid,false);
 assert.equal(inspectFormat('ipv6','::1').valid,true);
 assert.throws(()=>inspectJson('{}'),TypeError);
 assert.equal(inspectJson('[{"format":"email","value":"x@y.com"}]')[0].valid,true);
});
