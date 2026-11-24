import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspectorHttpHandler} from '../src/http.js';
const url='https://api.invalid/inspect';
const make=(body,contentType='application/json',method='POST')=>new Request(url,{method,headers:{'content-type':contentType},...(method==='POST'?{body}:{} )});
const serve=options=>createInspectorHttpHandler({authorize:async()=>true,consumeQuota:async()=>true,...options});
test('secure handler requires authorization and quota implementations',()=>{
 assert.throws(()=>createInspectorHttpHandler({authorize:()=>true}),TypeError);
 assert.throws(()=>createInspectorHttpHandler({consumeQuota:()=>true}),TypeError);
 assert.throws(()=>serve({maxBytes:Infinity}),RangeError);
});
test('unauthorized requests never consume quota or inspect the body',async()=>{
 let calls=0;
 const h=serve({authorize:()=>false,consumeQuota:()=>{calls++;return true;}});
 const r=await h(make('not JSON'));
 assert.equal(r.status,401);assert.equal(calls,0);
 assert.deepEqual(await r.json(),{error:'UNAUTHORIZED'});
});
test('quota denial is enforced before parsing content',async()=>{
 const r=await serve({consumeQuota:()=>false})(make('not JSON'));
 assert.equal(r.status,429);
});
test('successful syntax validation returns aggregate counts',async()=>{
 const body=JSON.stringify([{format:'email',value:'person@example.com'},{format:'date',value:'2023-02-29'}]);
 const r=await serve()(make(body));const json=await r.json();
 assert.equal(r.status,200);assert.deepEqual([json.total,json.valid,json.invalid],[2,1,1]);
 assert.equal(json.results[1].code,'INVALID_FORMAT');
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('CSV import works without external calls',async()=>{
 const r=await serve()(make('format,value\nemail,user@example.com\ndate,2024-02-29\n','text/csv'));
 assert.equal(r.status,200);assert.equal((await r.json()).valid,2);
});
test('NDJSON import works with per-row results',async()=>{
 const body='{"format":"uuid","value":"bad"}\n{"format":"ipv4","value":"127.0.0.1"}\n';
 const r=await serve()(make(body,'application/x-ndjson'));
 assert.equal(r.status,200);const json=await r.json();assert.equal(json.invalid,1);assert.equal(json.results[1].index,1);
});
test('malformed input yields safe failure response',async()=>{
 const r=await serve()(make('not-json'));assert.equal(r.status,400);
 assert.deepEqual(await r.json(),{error:'INVALID_INPUT'});
});
test('oversized body is rejected on real streamed bytes',async()=>{
 const r=await serve({maxBytes:16})(make(JSON.stringify([{format:'date',value:'2024-02-29'}])));
 assert.equal(r.status,413);assert.deepEqual(await r.json(),{error:'PAYLOAD_TOO_LARGE'});
});
test('unsupported content types are not parsed',async()=>{
 assert.equal((await serve()(make('abc','text/plain'))).status,415);
});
test('GET and preflight OPTIONS are denied without permissive CORS',async()=>{
 const handler=serve();
 for(const method of ['GET','OPTIONS']){
  const r=await handler(new Request(url,{method}));
  assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
});
test('thrown auth or quota errors fail closed',async()=>{
 assert.equal((await serve({authorize:()=>{throw Error('secret');}})(make('{}'))).status,401);
 const r=await serve({consumeQuota:()=>{throw Error('storage unavailable');}})(make('{}'));
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/storage unavailable/);
});
