import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
const app=fileURLToPath(new URL("../",import.meta.url));
const dir=await mkdtemp(join(tmpdir(),"commerce-kit-"));
const base="http://127.0.0.1:18939";
const child=spawn(process.execPath,[resolve(app,"src/server.js")],{env:{PATH:process.env.PATH,HOME:dir,HOST:"127.0.0.1",PORT:"18939",DB_PATH:join(dir,"fixture.sqlite"),BASE_URL:base,PADDLE_ENV:"sandbox",ENABLE_LIVE_BILLING:"0"},stdio:"ignore"});
let browser;
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+"/healthz")).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 browser=await chromium.launch({headless:true});
 const fixture="fixture_api_key_not_real",pass="fixture-long-passphrase-only";
 const requests=[],errors=[];
 async function newPage(){
  const c=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  const p=await c.newPage();p.on("request",r=>requests.push([r.method(),r.url()]));p.on("pageerror",e=>errors.push(e.name));
  await p.goto(base+"/key-backup");assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  return [c,p];
 }
 let [c,p]=await newPage();
 await p.locator("#product").fill("Fixture");
 await p.locator("#key").fill(fixture);
 await p.locator("#password").fill(pass);await p.locator("#confirm").fill(pass);
 await p.locator("#encrypt").click();await p.locator("#download").waitFor({state:"visible"});
 const encrypted=await p.locator("#archive").inputValue();assert.ok(encrypted&&!encrypted.includes(fixture));
 assert.equal(await p.locator("#key").inputValue(),"");assert.equal(await p.locator("#password").inputValue(),"");
 const downloadPromise=p.waitForEvent("download");await p.locator("#download").click();
 const download=await downloadPromise, backup=join(dir,"backup.json");await download.saveAs(backup);
 assert.equal(await readFile(backup,"utf8"),encrypted);
 await c.close();
 [c,p]=await newPage();
 await p.locator("#file").setInputFiles(backup);await p.waitForFunction(()=>document.getElementById("archive").value.length>0);
 await p.locator("#password").fill(pass);await p.locator("#decrypt").click();
 await p.waitForFunction(()=>document.getElementById("restored").value.length>0);
 assert.equal(await p.locator("#restored").inputValue(),fixture);
 await p.locator("#clear").click();assert.equal(await p.locator("#restored").inputValue(),"");
 await c.close();
 assert.deepEqual(errors,[]);
 assert.ok(requests.every(([method,url])=>method==="GET"&&url.startsWith(base+"/")&&["/key-backup","/key-backup.js","/key-backup.css","/favicon.ico"].includes(new URL(url).pathname)));
 console.log("Commerce browser QA: mobile layout, encrypted download, new browser context restore, no external/input requests PASS");
}finally{if(browser)await browser.close();child.kill();await new Promise(r=>child.once("exit",r));await rm(dir,{recursive:true,force:true})}
