import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {bindBillingContext} from "../src/billing-context.js";
const product="fil";
test("fresh database cannot change billing mode or product",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  bindBillingContext(db,{product,mode:"sandbox"});
  bindBillingContext(db,{product,mode:"sandbox"});
  assert.throws(()=>bindBillingContext(db,{product,mode:"live"}),/mismatch/);
  assert.throws(()=>bindBillingContext(db,{product:product==="wup"?"fil":"wup",mode:"sandbox"}),/mismatch/);
  assert.equal(db.prepare("SELECT mode FROM billing_context").get().mode,"sandbox");
 }finally{db.close();}
});
test("legacy data requires explicit sandbox adoption, never live adoption",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE api_keys(key_prefix TEXT NOT NULL)");
  db.prepare("INSERT INTO api_keys VALUES(?)").run(product+"_test_fixture");
  assert.throws(()=>bindBillingContext(db,{product,mode:"sandbox"}),/adoption/);
  assert.throws(()=>bindBillingContext(db,{product,mode:"live",adoptLegacySandbox:true}),/adoption/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='billing_context'").get().n,0);
  bindBillingContext(db,{product,mode:"sandbox",adoptLegacySandbox:true});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM api_keys").get().n,1);
  bindBillingContext(db,{product,mode:"sandbox"});
 }finally{db.close();}
});
test("legacy mixed-environment records fail without creating a marker",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE api_keys(key_prefix TEXT NOT NULL)");
  db.prepare("INSERT INTO api_keys VALUES(?)").run(product+"_live_fixture");
  assert.throws(()=>bindBillingContext(db,{product,mode:"sandbox",adoptLegacySandbox:true}),/mismatch/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='billing_context'").get().n,0);
 }finally{db.close();}
});
