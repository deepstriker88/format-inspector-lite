import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
async function run(preview){
 const elements=new Map();
 function element(id){
  if(!elements.has(id))elements.set(id,{disabled:true,checked:true,value:"fixture@example.com",dataset:{plan:"pro"},textContent:"",children:[],replaceChildren(...v){this.children=v},append(...v){this.children.push(...v)},addEventListener(name,fn){this[name]=fn}});
  return elements.get(id);
 }
 const buttons=[element("buy-pro"),element("buy-team")];buttons[1].dataset.plan="team";
 let activationRequests=0;
 const Paddle={Environment:{set(){}},Initialize(){},PricePreview:preview,Checkout:{open(){}}};
 const document={getElementById:element,querySelectorAll(){return buttons},createElement(tag){return element("new-"+tag)},createTextNode(text){return {text}}};
 const cfg={billingReady:true,paddleEnvironment:"sandbox",paddleClientToken:"test_fixture",proPriceId:"pri_pro",teamPriceId:"pri_team",pricing:{pro:{usdMonthly:3},team:{usdMonthly:7}}};
 const sandbox={document,window:{Paddle},Paddle,sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},fetch:async route=>{if(route==="/billing/activation")activationRequests++;return {ok:true,json:async()=>cfg}},setTimeout};
 await vm.runInNewContext(source,sandbox);
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

test("unpublished stable package is not presented as installable",()=>{
 const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.ok(html.includes("npm stable release pending"));
 assert.ok(!html.includes("npm install format-inspector-lite"));
});
