import {chromium} from "playwright";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"compact-landing-"));
const port=18787,base="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["hosted/src/server.js"],{env:{PATH:process.env.PATH,HOME:dir,HOST:"127.0.0.1",PORT:String(port),DB_PATH:path.join(dir,"fixture.sqlite"),BASE_URL:base,PADDLE_ENV:"sandbox",PADDLE_CLIENT_TOKEN:"test_fixture",PADDLE_WEBHOOK_SECRET:"fixture",PADDLE_PRICE_PRO:"pri_fixture_pro",PADDLE_PRICE_TEAM:"pri_fixture_team",ENABLE_LIVE_BILLING:"0"},stdio:["ignore","ignore","inherit"]});
let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+"/healthz")).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});
 await fs.mkdir("qa-screenshots",{recursive:true});
 const metrics=[];
 for(const [width,height] of [[320,568],[360,740],[390,844],[768,1024],[1024,768],[1280,720],[1440,900],[1920,1080]]){
  const context=await browser.newContext({viewport:{width,height}});
  const external=[],posts=[],errors=[];
  await context.route("**/*",route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base){external.push(url.origin);return route.abort();}if(req.method()!=="GET")posts.push(req.method()+" "+url.pathname);return route.continue();});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(String(e)));
  await page.goto(base+"/");await page.locator("#sample-run").waitFor();await page.waitForFunction(()=>!document.getElementById("sample-run").disabled);
  const box=await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,viewportHeight:innerHeight,viewportWidth:innerWidth,primaryBottom:document.getElementById("primary-try").getBoundingClientRect().bottom,reviewBottom:document.getElementById("primary-review").getBoundingClientRect().bottom,footerBottom:document.querySelector("footer").getBoundingClientRect().bottom,buttonHeight:document.getElementById("sample-run").getBoundingClientRect().height,inputSize:parseFloat(getComputedStyle(document.getElementById("sample-select")).fontSize)}));
  assert.equal(box.width,width,"horizontal overflow");
  assert.ok(box.primaryBottom<=height,"free action outside first viewport");
  assert.ok(box.reviewBottom<=height,"review action outside first viewport");
  if(width>=360)assert.ok(box.height<=height+1,"initial page requires vertical scroll: "+width+"x"+height+" height "+box.height);
  assert.ok(box.buttonHeight>=44&&box.inputSize>=16,"readability/touch sizing");
  await page.screenshot({path:"qa-screenshots/landing-"+width+"x"+height+".png",fullPage:true});
  await page.locator("#sample-run").click();assert.equal(await page.locator("#sample-output").getAttribute("data-state"),"fail");assert.notEqual(await page.locator("#sample-output").textContent(),"Example could not be checked.");
  await page.locator("#sample-select").selectOption("good");await page.locator("#sample-run").click();assert.equal(await page.locator("#sample-output").getAttribute("data-state"),"pass");
  assert.equal(posts.length,0,"local demo transmitted data");assert.equal(external.length,0,"external dependency before plans");
  await page.locator('[data-open="plans"]').first().click();await page.waitForFunction(()=>document.getElementById("plan-status").textContent.includes("no real payment"));
  assert.equal(await page.locator("#plans").evaluate(e=>e.open),true);
  assert.equal(await page.locator(".buy:disabled").count(),2);assert.equal(await page.locator("#checkout-fields").isVisible(),false);
  assert.equal(external.length,0,"sandbox must not load Paddle");assert.equal(posts.length,0);
  await page.keyboard.press("Escape");assert.equal(await page.locator("#plans").evaluate(e=>e.open),false);
  await page.locator('[data-open="more"]').click();assert.equal(await page.locator("#more").evaluate(e=>e.open),true);
  assert.ok((await page.locator("#more").textContent()).includes("npm install"));
  await page.keyboard.press("Escape");
  assert.equal(errors.length,0,errors.join("\n"));
  metrics.push({viewport:{width,height},...box,verticalScroll:Math.max(0,box.height-height),sample:"pass/fail verified",sandboxCheckout:"disabled",externalRequests:external.length,inputPosts:posts.length});
  await context.close();
 }
 await fs.writeFile("qa-screenshots/metrics.json",JSON.stringify(metrics,null,2)+"\n");
 console.log(JSON.stringify(metrics));
}finally{if(browser)await browser.close();server.kill("SIGTERM");await fs.rm(dir,{recursive:true,force:true});}
