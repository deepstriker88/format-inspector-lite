import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {chromium} from "playwright";
const app=fileURLToPath(new URL("../",import.meta.url));
const dir=await mkdtemp(join(tmpdir(),"desktop-audit-"));
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const base="http://127.0.0.1:"+port;
const child=spawn(process.execPath,[resolve(app,"src/server.js")],{env:{PATH:process.env.PATH,HOME:dir,HOST:"127.0.0.1",PORT:String(port),DB_PATH:join(dir,"fixture.sqlite"),BASE_URL:base,PADDLE_ENV:"sandbox",ENABLE_LIVE_BILLING:"0",BUY_ME_A_COFFEE_USERNAME:"synthetic_fixture"},stdio:"ignore"});
const routes=["/","/try","/review","/automation","/api","/key-backup","/key-recovery","/terms","/privacy","/refund"];
const viewports=[[1024,768],[1280,720],[1440,900],[1920,1080],[2560,1440],[3440,1440]];
const records=[];let browser;
const near=(a,b)=>Math.abs(a-b)<=3;
async function rect(p,sel){const x=await p.locator(sel).first().boundingBox();assert.ok(x,"missing rectangle: "+sel);return x;}
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+"/healthz")).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 browser=await chromium.launch({headless:true});
 await mkdir("qa-screenshots/desktop-audit",{recursive:true});
 for(const colorScheme of ["light","dark"])for(const [width,height] of viewports){
  const c=await browser.newContext({viewport:{width,height},colorScheme});
  const errors=[],posts=[];await c.route("**/*",r=>{const req=r.request();if(!req.url().startsWith(base+"/"))return r.abort();if(req.method()!=="GET"&&req.method()!=="HEAD")posts.push(req.url());return r.continue()});
  const p=await c.newPage();p.on("pageerror",e=>errors.push(e.message));
  for(const route of routes){
   await p.goto(base+route,{waitUntil:"load"});
   const size=await p.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:innerWidth,scheme:getComputedStyle(document.documentElement).colorScheme,main:document.querySelector("main")?.getBoundingClientRect().width??document.body.getBoundingClientRect().width}));
   assert.equal(size.scheme,colorScheme);assert.ok(size.doc<=width+1,route+" horizontal overflow "+JSON.stringify(size));
   if(["/","/try","/review","/automation"].includes(route))assert.ok(size.main/width>=.92,route+" unused horizontal space "+size.main);
   if(route==="/"||route==="/try"){
    await p.locator("#run").waitFor({state:"visible"});
    await p.waitForFunction(()=>!document.getElementById("run").disabled);
    const input=await rect(p,'.workspace>section[aria-label="Input"]');
    const empty=await rect(p,'.desktop-empty');
    const run=await rect(p,"#run"),editor=await rect(p,"#value");
    assert.ok(near(input.y,empty.y)&&near(input.height,empty.height)&&empty.x>input.x+input.width,route+" empty result column not reserved");
    assert.ok((empty.x+empty.width-input.x)/width>=.92,"workspace underfills display");
    assert.ok(editor.height>=120,"editor too small");
    assert.ok(run.y+run.height<=height+2,route+" action below initial viewport "+JSON.stringify(run));
    if(await p.locator("#schema").count()){
     const schema=await rect(p,"#schema");
     if(width>=1600){assert.ok(near(schema.y,editor.y)&&schema.x>editor.x+editor.width,"wide JSON editors must be adjacent");assert.ok(editor.height>=height*.35&&schema.height>=height*.35,"wide JSON editors too short")}
     else assert.ok(schema.y>editor.y,"narrow desktop JSON editors should stack");
    }
    if(route==="/"&&(width===1920||width===3440))await p.screenshot({path:"qa-screenshots/desktop-audit/"+colorScheme+"-"+width+"-home-empty.png"});
    await p.locator("#example").click();await p.locator("#result-panel").waitFor({state:"visible"});assert.ok(await p.locator(".desktop-empty").isHidden());
    const result=await rect(p,"#result-panel");assert.ok(near(result.x,empty.x)&&near(result.y,empty.y),"result jumps to different column");
    if(route==="/"&&(width===1920||width===3440))await p.screenshot({path:"qa-screenshots/desktop-audit/"+colorScheme+"-"+width+"-home-result.png"});
    await p.locator("#clear").click();assert.ok(await p.locator("#result-panel").isHidden());assert.ok(await p.locator(".desktop-empty").isVisible());
   }
   if(route==="/review"){
    const fields=p.locator(".review-workspace .input-field");
    assert.ok(await fields.count()>=2);
    const xs=await fields.evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,w:n.getBoundingClientRect().width})));
    assert.ok(xs.some((x,i)=>xs.slice(i+1).some(y=>near(x.y,y.y)&&y.x>=x.x+x.w-1)),"comparison inputs not side by side");
    const run=await rect(p,"#run");assert.ok(run.y+run.height<=height+2,"review action below first screen "+JSON.stringify(run));
   }
   if(route==="/api"){assert.equal(await p.locator(".desktop-api-links a").count(),4);assert.ok(await p.locator(".desktop-api").isVisible());}
   if(route==="/key-backup"||route==="/key-recovery"){
    const [a,b]=await p.locator("main>section").evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width})));
    assert.ok(near(a.y,b.y)&&b.x>a.x+a.w,"key management columns not adjacent");
   }
   if(["/terms","/privacy","/refund"].includes(route))assert.ok(size.main<=800,"legal prose unnecessarily stretched");
   if(route!=="/"&&(width===1920||width===3440))await p.screenshot({path:"qa-screenshots/desktop-audit/"+colorScheme+"-"+width+"-"+route.slice(1)+".png"});
   records.push({route,width,height,colorScheme,mainWidth:Math.round(size.main),passed:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);await c.close();
 }
 // A desktop-only layout must not disturb the existing compact phone layout.
 for(const width of [320,390,768]){
  const p=await browser.newPage({viewport:{width,height:width===768?1024:740}});
  await p.goto(base+"/",{waitUntil:"load"});assert.ok(await p.locator(".desktop-empty").isHidden());assert.ok(await p.locator("#result-panel").isHidden());
  const run=await rect(p,"#run");assert.ok(run.y+run.height<=(width===768?1024:740));
  await p.close();
 }
 await writeFile("qa-screenshots/desktop-audit/results.json",JSON.stringify(records,null,2));
 console.log("Desktop layout audit "+records.length+" combinations; private checks, result columns, editor size, review first action and billing navigation passed");
}finally{if(browser)await browser.close();child.kill();await new Promise(r=>child.once("exit",r));await rm(dir,{recursive:true,force:true})}
