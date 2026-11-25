import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Snapshot committed SQLite data, including WAL contents, with private permissions.
const sourcePath=process.env.DB_PATH||"/data/commerce.sqlite";
const directory=process.env.BACKUP_DIR||"/data/backups";
const retention=Number(process.env.BACKUP_RETENTION||31);
if(!Number.isSafeInteger(retention)||retention<1||retention>366)throw new Error("invalid backup retention");
if(!fs.statSync(sourcePath).isFile())throw new Error("database not found");
const explicit=process.argv[2];
const out=explicit||path.join(directory,"commerce-"+new Date().toISOString().replace(/[:.]/g,"-")+".sqlite3");
const parent=path.dirname(path.resolve(out));
fs.mkdirSync(parent,{recursive:true,mode:0o700});
const temp=fs.mkdtempSync(path.join(parent,".snapshot-"));
const snapshot=path.join(temp,"db.sqlite");
try{
  const db=new DatabaseSync(sourcePath,{readOnly:true});
  try{db.exec("PRAGMA busy_timeout=5000");db.exec("VACUUM INTO '"+snapshot.replaceAll("'","''")+"'");}
  finally{db.close();}
  fs.chmodSync(snapshot,0o600);
  const check=new DatabaseSync(snapshot,{readOnly:true});
  try{if(check.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")throw new Error("backup quick_check failed");}
  finally{check.close();}
  // Atomic publication without replacing an existing backup.
  fs.linkSync(snapshot,out);
  if(!explicit){
    const names=fs.readdirSync(parent,{withFileTypes:true}).filter(e=>e.isFile()&&/^commerce-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite3$/.test(e.name)).map(e=>e.name).sort();
    for(const name of names.slice(0,Math.max(0,names.length-retention)))fs.unlinkSync(path.join(parent,name));
  }
  console.log(JSON.stringify({ok:true,bytes:fs.statSync(out).size}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
