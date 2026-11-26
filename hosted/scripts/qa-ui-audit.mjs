import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {chromium} from "playwright";
const app=fileURLToPath(new URL("../",import.meta.url));
const dir=await mkdtemp(join(tmpdir(),"ui-audit-"));
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const base="http://127.0.0.1:"+port;
const child=spawn(process.execPath,[resolve(app,"src/server.js")],{env:{PATH:process.env.PATH,HOME:dir,HOST:"127.0.0.1",PORT:String(port),DB_PATH:join(dir,"fixture.sqlite"),BASE_URL:base,PADDLE_ENV:"sandbox",ENABLE_LIVE_BILLING:"0",BUY_ME_A_COFFEE_USERNAME:"synthetic_fixture"},stdio:"ignore"});
let browser;
const paths=["/","/try","/review","/api","/automation","/key-backup","/key-recovery","/terms","/privacy","/refund"];
const modalPaths=new Set(["/","/try","/review","/automation"]);
const results=[];
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+"/healthz")).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 const config=await (await fetch(base+"/config.json")).json();
 browser=await chromium.launch({headless:true});
 await mkdir("qa-screenshots/ui-audit",{recursive:true});
 for(const colorScheme of ["light","dark"]){
  for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900]]){
   const context=await browser.newContext({viewport:{width,height},colorScheme});
   // Never contact providers; UI test covers local layout only.
   const requests=[],pageErrors=[];
   await context.route("**/*",r=>{const req=r.request();if(req.url().startsWith(base+"/")){requests.push([req.method(),new URL(req.url()).pathname]);return r.continue()}return r.abort()});
   const p=await context.newPage();p.on("pageerror",e=>pageErrors.push(e.message));
   let palette;
   for(const route of paths){
    await p.goto(base+route,{waitUntil:"load"});
    await p.locator("h1").first().waitFor({state:"visible"});
    const state=await p.evaluate(()=>{
      const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body),head=getComputedStyle(document.querySelector("h1"));
      return {scheme:root.colorScheme,bg:root.getPropertyValue("--bg").trim(),ink:root.getPropertyValue("--ink").trim(),accent:root.getPropertyValue("--accent").trim(),font:root.fontFamily,bodyColor:body.color,headColor:head.color,headFont:head.fontFamily,width:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector("main")?.getBoundingClientRect().width??0}
    });
    assert.equal(state.scheme,colorScheme,route+" theme");
    assert.ok(state.width<=width+1,route+" horizontal overflow "+JSON.stringify(state));
    assert.ok(state.bg&&state.ink&&state.accent,route+" missing theme");
    const colors=[state.bg,state.ink,state.accent,state.font];
    if(!palette)palette=colors;else assert.deepEqual(colors,palette,route+" mismatched palette");
    assert.equal(state.headColor,state.bodyColor,route+" heading color mismatch");
    // Check actual foreground/background pairs, not just token names.
    const contrast=await p.evaluate(()=>{
      const rgb=x=>x.match(/[\d.]+/g)?.map(Number)||[];
      const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const background=el=>{while(el){const c=rgb(getComputedStyle(el).backgroundColor);if(c.length===3||c[3]===1)return c;el=el.parentElement}return [255,255,255]};
      const check=el=>{const c=rgb(getComputedStyle(el).color);return ratio(c,background(el))};
      return {heading:check(document.querySelector("h1")),body:check(document.body)};
    });
    assert.ok(contrast.heading>=4.5&&contrast.body>=4.5,route+" inadequate text contrast "+JSON.stringify(contrast));
    if(modalPaths.has(route)){
     const trigger=p.locator('a[href="/api#plans"]').first();
     const input=p.locator("textarea:visible,input[type=text]:visible").first();
     const hasInput=await input.count()>0;
     if(hasInput)await input.fill("UI_PRIVATE_FIXTURE");
     const start=p.url(),n=requests.length;
     await trigger.click();
     const dialog=p.locator("#ez-plans");
     await dialog.waitFor({state:"visible"});
     assert.equal(p.url(),start);
     assert.equal(requests.length,n,route+" preview made network request");
     const box=await dialog.boundingBox();
     assert.ok(box.x>=-1&&box.x+box.width<=width+1&&box.y>=-1&&box.y+box.height<=height+1,route+" modal overflow");
     for(const plan of ["pro","team"]){const price=config.pricing[plan];assert.ok((await dialog.textContent()).includes("$"+price.usdMonthly.toFixed(2)));assert.ok((await dialog.textContent()).includes(price.monthlyRequests.toLocaleString("en-US")))}
     assert.match(await dialog.textContent(),/real-money payments are not enabled/);
     assert.equal(await dialog.locator("a.ez-continue").getAttribute("target"),"_blank");
     for(const link of await dialog.locator("a").all()){
      assert.equal(await link.getAttribute("target"),"_blank");
      assert.match(await link.getAttribute("rel"),/noopener/);
     }

     if(route==="/"&&width===390){
      const popupPromise=p.waitForEvent("popup");
      await dialog.locator("a.ez-continue").click();
      const popup=await popupPromise;await popup.waitForLoadState("load");
      assert.equal(new URL(popup.url()).pathname,"/api");
      assert.equal(new URL(popup.url()).hash,"#plans");
      await popup.locator("#plans,#plans-dialog").waitFor({state:"visible"});
      assert.equal(p.url(),start);
      assert.ok(await dialog.isVisible());
      if(hasInput)assert.equal(await input.inputValue(),"UI_PRIVATE_FIXTURE");
      await popup.close();await p.bringToFront();
     }
     assert.ok(await dialog.locator("button").evaluate(x=>x.getBoundingClientRect().height>=44));
     if(width===390||width===1440)await p.screenshot({path:"qa-screenshots/ui-audit/"+colorScheme+"-"+width+"-"+(route.slice(1)||"home")+"-plans.png"});
     await p.keyboard.press("Escape");assert.ok(await dialog.isHidden());
     if(hasInput)assert.equal(await input.inputValue(),"UI_PRIVATE_FIXTURE");
     assert.equal(await trigger.evaluate(x=>document.activeElement===x),true);
    }
    if(width===390||width===1440)await p.screenshot({path:"qa-screenshots/ui-audit/"+colorScheme+"-"+width+"-"+(route.slice(1)||"home")+".png"});
    results.push({route,width,height,colorScheme,layout:"pass",theme:"pass",modal:modalPaths.has(route)?"pass":"n/a"});
   }
   await p.goto(base+"/api#plans",{waitUntil:"load"});
   const billing=p.locator("#plans,#plans-dialog");
   await billing.waitFor({state:"visible"});
   const bounds=await billing.boundingBox();
   assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1&&bounds.y>=-1&&bounds.y+bounds.height<=height+1,"billing dialog overflow");
   const close=billing.getByRole("button",{name:"Close",exact:true}).first();
   assert.ok(await close.evaluate(x=>x.getBoundingClientRect().height>=44));
   await close.click();assert.ok(await billing.isHidden());
   assert.deepEqual(pageErrors,[]);
   assert.ok(requests.every(([method])=>method==="GET"||method==="HEAD"),"Unexpected input upload");
   await context.close();
  }
 }
 await writeFile("qa-screenshots/ui-audit/results.json",JSON.stringify(results,null,2));
 console.log("Full UI audit: "+results.length+" route/theme/viewport combinations");
}finally{if(browser)await browser.close();child.kill();await new Promise(r=>child.once("exit",r));await rm(dir,{recursive:true,force:true})}
