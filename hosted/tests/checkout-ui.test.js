import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
async function run(preview,mode="live"){
 const elements=new Map();
 function element(id){
  if(!elements.has(id))elements.set(id,{disabled:true,checked:true,value:"fixture@example.com",dataset:{plan:"pro",open:"plans"},textContent:"",children:[],replaceChildren(...v){this.children=v},append(...v){this.children.push(...v)},showModal(){this.open=true},addEventListener(name,fn){this[name]=fn}});
  return elements.get(id);
 }
 const buttons=[element("buy-pro"),element("buy-team")];buttons[1].dataset.plan="team";
 let activationRequests=0;
 const Paddle={Environment:{set(){}},Initialize(){},PricePreview:preview,Checkout:{open(){}}};
 const document={getElementById:element,querySelectorAll(selector){return selector===".buy"?buttons:selector==="[data-open]"?[element("open-plans")]:[]},createElement(tag){return element("new-"+tag)},createTextNode(text){return {text}}};
 const cfg={billingReady:true,paddleEnvironment:mode,paddleClientToken:"test_fixture",proPriceId:"pri_pro",teamPriceId:"pri_team",pricing:{pro:{usdMonthly:3,monthlyRequests:10},team:{usdMonthly:7,monthlyRequests:100}}};
 const sandbox={document,window:{Paddle},Paddle,sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},fetch:async route=>{if(route==="/billing/activation")activationRequests++;return {ok:true,json:async()=>cfg}},setTimeout};
 await vm.runInNewContext(source,sandbox);
 await element("open-plans").click();
 await new Promise(resolve=>setImmediate(resolve));
 return {buttons,element,requests:()=>activationRequests};
}
test("failed or incomplete provider preview cannot enable checkout",async()=>{
 for(const preview of [async()=>{throw Error("unavailable")},async()=>({data:{details:{lineItems:[]}}})]){
  const r=await run(preview);
  assert.ok(r.buttons.every(x=>x.disabled));
  await r.buttons[0].click();
  assert.equal(r.requests(),0);
 }
});
test("provider price is inserted as text, not markup",async()=>{
 const unsafe="<img src=x onerror=alert(1)>";
 const r=await run(async()=>({data:{details:{lineItems:[{price:{id:"pri_pro"},formattedTotals:{subtotal:unsafe}},{price:{id:"pri_team"},formattedTotals:{subtotal:"$7"}}]}}}));
 assert.ok(r.buttons.every(x=>!x.disabled));
 assert.equal(r.element("pro-price").children[0].text,unsafe);
 assert.ok(!source.includes("innerHTML"));
});

test("published stable package is presented as installable",()=>{
 const html=fs.readFileSync(new URL("../public/api.html",import.meta.url),"utf8");
 assert.ok(html.includes("npm 0.1.0"));
 assert.ok(html.includes("npm install format-inspector-lite"));
});

test("sandbox never opens checkout even with a configured catalog",async()=>{const r=await run(async()=>{throw Error("must not call provider")},"sandbox");assert.ok(r.buttons.every(b=>b.disabled));await r.buttons[0].click();assert.equal(r.requests(),0);});
