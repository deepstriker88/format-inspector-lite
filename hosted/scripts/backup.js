import fs from "node:fs";
import path from "node:path";

const db=process.env.DB_PATH||"/data/commerce.sqlite";
const out=process.argv[2]||path.join("/data","backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".sqlite");
if(!fs.existsSync(db)) throw new Error("database not found");
fs.copyFileSync(db,out,fs.constants.COPYFILE_EXCL);
fs.chmodSync(out,0o600);
console.log(JSON.stringify({ok:true,backup:out}));
