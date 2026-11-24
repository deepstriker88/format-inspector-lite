import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {createServer} from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function freePort(){return await new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function start(enable){
 const dir=await mkdtemp(path.join(os.tmpdir(),"live-gate-"));const port=await freePort();const base="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,[path.join(hostedRoot,"src/server.js")],{cwd:hostedRoot,env:{...process.env,HOST:"127.0.0.1",PORT:String(port),DB_PATH:path.join(dir,"db.sqlite"),PADDLE_ENV:"live",ENABLE_LIVE_BILLING:enable?"1":"0",PADDLE_CLIENT_TOKEN:"live_test_token",PADDLE_WEBHOOK_SECRET:"secret",PADDLE_PRICE_PRO:"pri_test_pro",PADDLE_PRICE_TEAM:"pri_test_team"},stdio:["ignore","ignore","pipe"]});
 for(let i=0;i<60;i++){try{const r=await fetch(base+"/config.json");if(r.ok)return{child,dir,base,config:await r.json()}}catch{}await new Promise(r=>setTimeout(r,50))}
 child.kill("SIGTERM");await rm(dir,{recursive:true,force:true});throw new Error("server not ready")
}
async function stop(x){x.child.kill("SIGTERM");await new Promise(r=>{if(x.child.exitCode!==null)r();else{x.child.once("exit",r);setTimeout(r,1000).unref()}});await rm(x.dir,{recursive:true,force:true})}

test("live billing requires the explicit second gate",async()=>{
 const locked=await start(false);try{assert.equal(locked.config.paddleEnvironment,"sandbox")}finally{await stop(locked)}
 const enabled=await start(true);try{assert.equal(enabled.config.paddleEnvironment,"live")}finally{await stop(enabled)}
});
