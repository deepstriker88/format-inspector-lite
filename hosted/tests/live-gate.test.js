import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {createServer} from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function scenario(mode,enable,token,expected,ready){
 const dir=await mkdtemp(path.join(os.tmpdir(),"billing-gate-"));const port=await freePort();const base="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,[path.join(root,"src/server.js")],{cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(port),DB_PATH:path.join(dir,"db.sqlite"),PADDLE_ENV:mode,ENABLE_LIVE_BILLING:enable,PADDLE_CLIENT_TOKEN:token,PADDLE_WEBHOOK_SECRET:"fixture_only_secret",PADDLE_PRICE_PRO:"pri_test_pro",PADDLE_PRICE_TEAM:"pri_test_team"},stdio:"ignore"});
 try{
  let cfg;
  for(let i=0;i<60;i++){try{const r=await fetch(base+"/config.json");if(r.ok){cfg=await r.json();break}}catch{}await new Promise(r=>setTimeout(r,50))}
  assert.ok(cfg);assert.equal(cfg.paddleEnvironment,expected);assert.equal(cfg.billingReady,ready);
  if(!ready){
   assert.equal(cfg.paddleClientToken,"");assert.equal(cfg.proPriceId,"");assert.equal(cfg.teamPriceId,"");
   const a=await fetch(base+"/billing/activation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"fixture@example.com",plan:"pro"})});
   assert.equal(a.status,503);
  }
 }finally{
  if(child.exitCode===null){const exited=new Promise(r=>child.once("exit",r));child.kill("SIGTERM");await exited;}
  await rm(dir,{recursive:true,force:true});
 }
}
test("billing rejects unapproved live, token environment mismatch and unknown mode",async()=>{
 await scenario("live","0","live_fixture","sandbox",false);
 await scenario("sandbox","1","live_fixture","sandbox",false);
 await scenario("live","1","test_fixture","live",false);
 await scenario("invalid","1","test_fixture","sandbox",false);
 await scenario("sandbox","0","test_fixture","sandbox",true);
 await scenario("live","1","live_fixture","live",true);
});
