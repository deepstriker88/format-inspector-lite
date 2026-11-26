import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../public/api.html",import.meta.url),"utf8");
const weburl=html.includes('id="plans-dialog"');
const source=weburl?html.match(/<script>([\s\S]*?)<\/script>/)[1]:fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const modal=weburl?"plans-dialog":"plans";
const storageKey=weburl?"weburl-active-claim":html.includes("format-inspector-lite")?"fil-active-claim":"fpe-active-claim";
const claim={activationId:"act_fixture",claimSecret:"claim_fixture"};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(saved=null,denyStorage=false){
 const elements=new Map(), store=new Map(saved?[[storageKey,JSON.stringify(saved)]]:[]);
 let claims=0,activations=0,checkouts=0,eventCallback,opened,releaseClaim;
 function element(id){
  if(!elements.has(id))elements.set(id,{hidden:true,disabled:true,open:false,checked:true,value:"fixture@example.invalid",style:{},dataset:{plan:"pro",open:"plans"},textContent:"",children:[],
   showModal(){assert.equal(this.open,false);this.open=true},close(){this.open=false},focus(){},addEventListener(name,fn){this[name]=fn},replaceChildren(...v){this.children=v},append(...v){this.children.push(...v)}});
  return elements.get(id);
 }
 const buttons=[element("buy-pro"),element("buy-team")];buttons[1].dataset.plan="team";
 const cfg={billingReady:true,paddleEnvironment:"live",paddleClientToken:"fixture",proPriceId:"pri_pro",teamPriceId:"pri_team",pricing:{pro:{usdMonthly:3,monthlyRequests:10},team:{usdMonthly:7,monthlyRequests:100}}};
 const Paddle={Initialize(o){eventCallback=o.eventCallback},Environment:{set(){}},PricePreview:async()=>({data:{details:{lineItems:[{price:{id:"pri_pro"},formattedTotals:{subtotal:"$3"}},{price:{id:"pri_team"},formattedTotals:{subtotal:"$7"}}]}}}),Checkout:{open(o){checkouts++;opened=o;assert.equal(element(modal).open,false);assert.ok(store.has(storageKey))}}};
 const context={document:{getElementById:element,querySelectorAll(s){return s===".buy"?buttons:s==="[data-open]"?[element("open-plans")]:[]},createElement:element,createTextNode(text){return {text}}},window:{Paddle,location:{origin:"https://fixture.invalid",hash:saved?"#plans":""}},Paddle,matchMedia:()=>({matches:false}),console:{warn(){},error(){}},setTimeout,
 sessionStorage:{getItem(k){return store.get(k)||null},setItem(k,v){if(denyStorage)throw Error("storage unavailable");store.set(k,v)},removeItem(k){store.delete(k)}},
 fetch:async(route,opts)=>{if(route==="/config.json")return {ok:true,json:async()=>cfg};if(route==="/billing/activation"){activations++;return {ok:true,json:async()=>({...claim,billingReady:true,paddlePriceId:"pri_pro"})}}if(route==="/billing/claim"){claims++;assert.deepEqual(JSON.parse(opts.body),claim);return new Promise(resolve=>{releaseClaim=()=>resolve({ok:true,status:200,json:async()=>({apiKey:"fixture_key",apiKeyStatus:"active",plan:"pro"})})})}throw Error("unexpected route")}};
 vm.createContext(context);vm.runInContext(source,context);
 if(!weburl&&!saved){await element("open-plans").click()}
 await settle();
 return {element,buttons,store,counts:()=>({claims,activations,checkouts}),event:e=>eventCallback({name:e}),opened:()=>opened,release:()=>releaseClaim(),
  start:async()=>{if(weburl){element("plans-inline").click();buttons[0].click();vm.runInContext('startPurchase("pro")',context);vm.runInContext('startPurchase("pro")',context);await settle()}else{await Promise.all([buttons[0].click(),buttons[0].click()])}}};
}
test("saved payment is visible, never consumed during navigation, and concurrent manual checks coalesce",async()=>{
 const r=await setup(claim);
 assert.equal(r.element(modal).open,true);
 assert.equal(r.element("resume-claim").hidden,false);
 assert.equal(r.counts().claims,0);
 const a=r.element("resume-claim").click(), b=r.element("resume-claim").click();
 assert.equal(r.counts().claims,1);
 r.release();await Promise.all([a,b]);
 assert.equal(r.store.has(storageKey),false);
 assert.equal(r.element("resume-claim").hidden,true);
 assert.match(JSON.stringify(r.element("api-key-box")),/fixture_key/);
});
test("checkout opens once, stores recovery proof first, and completion does not consume the key",async()=>{
 const r=await setup();await r.start();
 assert.deepEqual(r.counts(),{claims:0,activations:1,checkouts:1});
 assert.equal(r.opened().settings.successUrl,"https://fixture.invalid/api#plans");
 r.event("checkout.completed");assert.equal(r.counts().claims,0);
 r.event("checkout.closed");assert.equal(r.element(modal).open,true);
 assert.equal(r.element("resume-claim").hidden,false);
 assert.ok(r.buttons.every(b=>b.disabled));
});
test("blocked browser storage cannot open a checkout",async()=>{
 const r=await setup(null,true);await r.start();
 assert.equal(r.counts().checkouts,0);
 assert.equal(r.counts().claims,0);
});
