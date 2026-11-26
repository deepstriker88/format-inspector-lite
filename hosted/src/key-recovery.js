import {createHash} from "node:crypto";

// A recovery code is a separate high-entropy bearer credential, never an email/receipt ID.
// Caller generates and saves the new credentials before submitting: no lost-response key loss.
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
function validToken(value,prefix){
 if(typeof value!=="string"||!value.startsWith(prefix))return false;
 const tail=value.slice(prefix.length);
 return /^[A-Za-z0-9_-]{43}$/.test(tail)&&Buffer.from(tail,"base64url").toString("base64url")===tail;
}
export function initRecovery(db){
 db.exec("CREATE TABLE IF NOT EXISTS key_recovery (api_key_id INTEGER PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, updated_at INTEGER NOT NULL)");
}
export function createRecovery(db,{product,mode,isBlocked=()=>false}){
 if(!/^[a-z][a-z0-9]{1,11}$/.test(product)||!["sandbox","live"].includes(mode))throw Error("invalid recovery context");
 const keyPrefix=product+"_"+(mode==="live"?"live":"test")+"_";
 const codePrefix="rcv_"+keyPrefix;
 const eligible="k.status='active' AND k.paddle_customer_id IS NOT NULL AND k.paddle_subscription_id IS NOT NULL AND EXISTS (SELECT 1 FROM activations a WHERE a.api_key_id=k.id AND a.status='paid' AND a.paddle_customer_id=k.paddle_customer_id AND a.paddle_subscription_id=k.paddle_subscription_id) AND NOT EXISTS (SELECT 1 FROM subscription_states s WHERE s.subscription_id=k.paddle_subscription_id AND s.status<>'active')";
 const tx=fn=>{db.exec("BEGIN IMMEDIATE");try{const result=fn();db.exec("COMMIT");return result}catch(e){db.exec("ROLLBACK");throw e}};
 const now=()=>Math.floor(Date.now()/1000);
 const bad={status:401,error:"recovery_not_authorized"};
 return {
  keyPrefix,codePrefix,
  enroll(key,code){
   if(!validToken(key,keyPrefix)||!validToken(code,codePrefix)||key.slice(keyPrefix.length)===code.slice(codePrefix.length))return bad;
   return tx(()=>{
    const row=db.prepare("SELECT k.id FROM api_keys k WHERE k.key_hash=? AND "+eligible).get(hash(key));
    if(!row||isBlocked(row.id))return bad;
    if(db.prepare("SELECT 1 FROM key_recovery WHERE api_key_id=?").get(row.id))return {status:409,error:"recovery_already_enrolled"};
    if(db.prepare("SELECT 1 FROM key_recovery WHERE code_hash=?").get(hash(code)))return {status:409,error:"credential_conflict"};
    db.prepare("INSERT INTO key_recovery(api_key_id,code_hash,updated_at) VALUES(?,?,?)").run(row.id,hash(code),now());
    return {status:200,ok:true};
   });
  },
  rotate(code,newKey,newCode){
   if(!validToken(code,codePrefix)||!validToken(newKey,keyPrefix)||!validToken(newCode,codePrefix)||code===newCode||newKey.slice(keyPrefix.length)===newCode.slice(codePrefix.length)||newKey.slice(keyPrefix.length)===code.slice(codePrefix.length))return bad;
   return tx(()=>{
    const row=db.prepare("SELECT k.id,k.key_hash FROM key_recovery r JOIN api_keys k ON k.id=r.api_key_id WHERE r.code_hash=? AND "+eligible).get(hash(code));
    if(!row||isBlocked(row.id))return bad;
    if(row.key_hash===hash(newKey)||db.prepare("SELECT 1 FROM api_keys WHERE key_hash=?").get(hash(newKey))||db.prepare("SELECT 1 FROM key_recovery WHERE code_hash=?").get(hash(newCode)))return {status:409,error:"credential_conflict"};
    db.prepare("UPDATE api_keys SET key_hash=?,key_prefix=?,updated_at=? WHERE id=?").run(hash(newKey),newKey.slice(0,16),now(),row.id);
    db.prepare("UPDATE key_recovery SET code_hash=?,updated_at=? WHERE api_key_id=?").run(hash(newCode),now(),row.id);
    // Prevent the original activation claim from ever returning a superseded key.
    db.prepare("UPDATE activations SET api_key_plain=NULL WHERE api_key_id=?").run(row.id);
    return {status:200,ok:true};
   });
  }
 };
}
