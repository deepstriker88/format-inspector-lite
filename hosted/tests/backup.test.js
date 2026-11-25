import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../scripts/backup.js",import.meta.url));
test("backup includes committed uncheckpointed WAL and is private, non-overwriting",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sqlite-backup-"));
 let db,copy;
 try{
  const source=path.join(dir,"source.sqlite"),out=path.join(dir,"backup.sqlite");
  db=new DatabaseSync(source);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('fixture');");
  assert.ok(fs.statSync(source+"-wal").size>0);
  const run=()=>spawnSync(process.execPath,[script,out],{env:{...process.env,DB_PATH:source},encoding:"utf8"});
  assert.equal(run().status,0);
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  copy=new DatabaseSync(out,{readOnly:true});
  assert.equal(copy.prepare("SELECT v FROM t").get().v,"fixture");
  assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check,"ok");
  copy.close();copy=undefined;
  assert.notEqual(run().status,0);
  assert.equal(fs.readdirSync(dir).filter(n=>n.startsWith(".snapshot-")).length,0);
 }finally{copy?.close();db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
