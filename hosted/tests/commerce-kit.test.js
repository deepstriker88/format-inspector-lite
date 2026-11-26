import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {encryptBackup,decryptBackup} from "../public/key-backup.js";
import {portalLink,renderSupport} from "../src/support.js";
const pass="fixture-only-long-passphrase";
const key="fixture_existing_api_key";
test("portable encrypted backup round trips; random salt and IV; no plaintext",async()=>{
 const a=await encryptBackup("Fixture",key,pass,webcrypto),b=await encryptBackup("Fixture",key,pass,webcrypto);
 assert.notEqual(a,b);assert.notEqual(JSON.parse(a).salt,JSON.parse(b).salt);assert.notEqual(JSON.parse(a).iv,JSON.parse(b).iv);
 assert.ok(!a.includes(key)&&!a.includes(pass));
 assert.deepEqual(await decryptBackup(a,pass,webcrypto),{product:"Fixture",key});
 await assert.rejects(decryptBackup(a,"incorrect-long-passphrase",webcrypto));
 const changed=JSON.parse(a);changed.ciphertext=(changed.ciphertext[0]==="A"?"B":"A")+changed.ciphertext.slice(1);
 await assert.rejects(decryptBackup(JSON.stringify(changed),pass,webcrypto));
});
test("input bounds and unsupported formats rejected before crypto",async()=>{
 await assert.rejects(encryptBackup("Fixture","x".repeat(513),pass,webcrypto));
 await assert.rejects(encryptBackup("Fixture",key,"short",webcrypto));
 for(const value of ["{}", "x".repeat(4097), '{"format":"eztoolgo-key-backup-v1","salt":"A","iv":"A","ciphertext":"A"}'])await assert.rejects(decryptBackup(value,pass,webcrypto));
});
test("public portal only; correct environment and no session tokens",()=>{
 const u="https://customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw";
 assert.match(portalLink(u,"live"),/Manage subscription/);
 assert.equal(portalLink(u,"sandbox"),"");
 assert.equal(portalLink(u+"?token=private","live"),"");
 assert.equal(portalLink(u+"#test","live"),"");
 assert.equal(portalLink(u.replace("paddle.com","paddle.com.evil.invalid"),"live"),"");
 assert.equal(portalLink("https://sandbox-customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw","sandbox").includes("Manage subscription"),true);
 assert.equal(renderSupport("a<!-- optional-customer-portal -->b",null,null,"sandbox"),"ab");
});
