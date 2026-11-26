import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  return await new Promise((resolve, reject) => {
    const sock = createServer();
    sock.once("error", reject);
    sock.listen(0, "127.0.0.1", () => {
      const port = sock.address().port;
      sock.close(() => resolve(port));
    });
  });
}

test("isolated sandbox flow: activate -> signed webhook -> one-time claim -> API -> cancel", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fil-flow-"));
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  const secret = "isolated_sandbox_webhook_secret_not_live";
  const child = spawn(process.execPath, [path.join(hostedRoot,"src/server.js")], {
    cwd: hostedRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      DB_PATH: path.join(dir, "commerce.sqlite"),
      BASE_URL: base,
      PADDLE_ENV: "sandbox",
      PADDLE_CLIENT_TOKEN: "test_isolated_client",
      PADDLE_WEBHOOK_SECRET: secret,
      PADDLE_PRICE_PRO: "pri_test_pro",
      PADDLE_PRICE_TEAM: "pri_test_team",
      ENABLE_TEST_ADMIN: "0",
      ADMIN_TOKEN: "",
      INDEXNOW_KEY: "0123456789abcdef0123456789abcdef",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk).slice(0, 250); });
  const request = async (route, value, headers = {}) => {
    const response = await fetch(base + route, {
      method: value === undefined ? "GET" : "POST",
      headers: value === undefined ? headers : { "content-type": "application/json", ...headers },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    return { status: response.status, body: await response.json() };
  };
  const webhook = async (type, id, data, occurredAt = new Date().toISOString()) => {
    const raw = JSON.stringify({ event_id: id, event_type: type, occurred_at: occurredAt, data });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", secret)
      .update(timestamp + ":" + raw).digest("hex");
    const response = await fetch(base + "/billing/paddle", {
      method: "POST",
      headers: { "content-type":"application/json", "paddle-signature": "ts=" + timestamp + ";h1=" + signature },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await request("/healthz");
        if (response.status === 200) { ready = true; break; }
      } catch {}
      await pause(100);
    }
    assert.ok(ready, "isolated server not ready: " + errors.slice(0, 300));
    const oversizedHeader = await fetch(base + "/healthz", { headers: { "x-test-padding": "a".repeat(9000) } });
    assert.equal(oversizedHeader.status, 431);
    await oversizedHeader.arrayBuffer();

    const headers = await fetch(base + "/healthz");
    assert.equal(headers.headers.get("strict-transport-security"), "max-age=86400");
    assert.equal(headers.headers.get("x-content-type-options"), "nosniff");
    assert.match(headers.headers.get("content-security-policy"), /style-src[^;]*https:\/\/sandbox-cdn\.paddle\.com/);
    for (const route of ["/", "/api", "/review", "/review/style.css", "/review/tool.js", "/review/index.js", "/review/strict-json.js", "/review/contract.js", "/review/csv.js", "/try", "/try/style.css", "/try/tool.js", "/try/core.js", "/try/strict-json.js", "/try/csv.js", "/try/convert.js", "/app.js", "/robots.txt", "/sitemap.xml", "/terms", "/privacy", "/refund"]) {
      const head = await fetch(base + route, { method: "HEAD" });
      assert.equal(head.status, 200, "HEAD should succeed for " + route);
      assert.ok(Number(head.headers.get("content-length")) > 0, "HEAD should expose content-length for " + route);
      assert.equal(await head.text(), "");
    }
    const home=await fetch(base+"/");
    assert.match(home.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.equal(home.headers.get("referrer-policy"),"no-referrer");
    const homeHtml=await home.text();
    assert.match(homeHtml,/id="run"/);
    assert.match(homeHtml,/href="\/api#plans"/);
    assert.doesNotMatch(homeHtml, /paddle\.js|<form|<script[^>]+src="https?:/i);
    const apiPage=await fetch(base+"/api");
    assert.match(await apiPage.text(), /Paddle/i);
    const localPage = await fetch(base + "/try");
    assert.match(localPage.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.match(localPage.headers.get("content-security-policy"), /form-action 'none'/);
    assert.equal(localPage.headers.get("referrer-policy"), "no-referrer");
    const localHtml = await localPage.text();
    assert.doesNotMatch(localHtml, /paddle\.js|<form|https:\/\//i);
    assert.match(localHtml, /\/try\/tool\.js/);
    const localCore = await fetch(base + "/try/core.js");
    assert.match(await localCore.text(), /export function /);
    const module_strict_json = await fetch(base + "/try/strict-json.js");
    assert.equal(module_strict_json.status,200);
    assert.match(module_strict_json.headers.get("content-type"), /^application\/javascript/);
    const module_csv = await fetch(base + "/try/csv.js");
    assert.equal(module_csv.status,200);
    assert.match(module_csv.headers.get("content-type"), /^application\/javascript/);
    assert.equal((await fetch(base + "/try/contract.js")).status,404);
    const review=await fetch(base+"/review");
    assert.equal(review.status,200);
    assert.match(review.headers.get("content-security-policy"),/connect-src 'none'/);
    assert.match(review.headers.get("content-security-policy"),/form-action 'none'/);
    assert.equal(review.headers.get("referrer-policy"),"no-referrer");
    const reviewHtml=await review.text();
    assert.match(reviewHtml,/\/review\/tool.js/);
    assert.doesNotMatch(reviewHtml,/<form|paddle\.js|<script[^>]+src="https?:/i);
    assert.equal((await fetch(base+"/review/unknown.js")).status,404);
    const site=await fetch(base+"/sitemap.xml");
    assert.match(await site.text(),/\/review<\/loc>/);
    const indexNow = await fetch(base + "/0123456789abcdef0123456789abcdef.txt");
    assert.equal(indexNow.status, 200);
    assert.equal(await indexNow.text(), "0123456789abcdef0123456789abcdef");
    assert.match(indexNow.headers.get("content-type"), /^text\/plain/);

    const config = await request("/config.json");
    assert.equal(config.body.paddleEnvironment, "sandbox");
    assert.equal(config.body.billingReady, true);
    assert.equal(config.body.pricing.pro.monthlyRequests, 25000);

    const free = await request("/demo/inspect", {format:"email",value:"user@example.com"});
    assert.equal(free.status, 200);
    assert.equal(free.body.valid, true);
    assert.equal(free.body.code, "OK");

    const withoutKey = await request("/v1/inspect", {format:"email",value:"user@example.com"});
    assert.equal(withoutKey.status, 401);

    const activation = await request("/billing/activation", {
      email:"isolated-sandbox@example.invalid", plan:"pro"
    });
    assert.equal(activation.status, 201);
    assert.equal(activation.body.billingReady, true);
    const { activationId, claimSecret } = activation.body;
    assert.match(activationId, /^act_/);
    const pending = await request("/billing/claim", { activationId, claimSecret });
    assert.equal(pending.status, 202);
    assert.equal((await request("/internal/test/activate", {plan:"team"})).status,404);
    assert.equal((await request("/billing/claim",{activationId,claimSecret:"invalid"})).status,401);

    // Malformed body roots and invalid UTF-8 are client errors, not server failures.
    for(const body of ["null","[]","123",Buffer.from([255])]){
      const bad=await fetch(base+"/billing/activation",{method:"POST",headers:{"content-type":"application/json"},body});
      assert.equal(bad.status,400);
    }
    assert.equal((await request("/healthz")).status,200);
    const invalidSig = await request("/billing/paddle", { event_id:"evt_invalid",event_type:"transaction.completed" });
    assert.equal(invalidSig.status, 401);

    const purchase = {
      id:"txn_isolated", status:"completed", collection_mode:"automatic",
      customer_id:"ctm_isolated", subscription_id:"sub_isolated",
      custom_data:{activation_id:activationId},
      items:[{price:{id:"pri_test_pro"},quantity:1}],
      details:{totals:{total:"299"}},
    };
    const fakeFree = await webhook("transaction.completed","evt_zero_001",{
      ...purchase,details:{totals:{total:"0"}}
    });
    assert.equal(fakeFree.status,200);
    assert.equal((await request("/billing/claim",{activationId,claimSecret})).status,202);
    const fakeTeam = await webhook("transaction.completed","evt_wrong_001",{
      ...purchase,items:[{price:{id:"pri_test_team"},quantity:1}]
    });
    assert.equal(fakeTeam.status,200);
    assert.equal((await request("/billing/claim",{activationId,claimSecret})).status,202);
    const completed = await webhook("transaction.completed", "evt_paid_001", purchase);
    assert.equal(completed.status, 200);
    const duplicate = await webhook("transaction.completed", "evt_paid_001", purchase);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);

    const claimed = await request("/billing/claim", { activationId, claimSecret });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.apiKeyStatus, "active");
    assert.match(claimed.body.apiKey, /^fil_test_/);
    const secondClaim = await request("/billing/claim", { activationId, claimSecret });
    assert.equal(secondClaim.status, 410);

    const token = {authorization:"Bearer " + claimed.body.apiKey};
    const malformed=await fetch(base+"/v1/inspect",{method:"POST",headers:{"content-type":"application/json",...token},body:"{"});
    assert.equal(malformed.status,400);
    assert.equal((await request("/v1/usage",undefined,token)).body.used,0);

    const inspected = await request("/v1/inspect", {format:"email",value:"user@example.com"}, token);
    assert.equal(inspected.status, 200);
    assert.equal(inspected.body.valid, true);
    assert.equal(inspected.body.code, "OK");
    assert.equal(inspected.body.usage.used,1);
    const usage = await request("/v1/usage", undefined, token);
    assert.equal(usage.body.used,1);
    assert.equal(usage.body.plan,"pro");

    const recoveryConfig = await request("/billing/recovery-config");
    assert.equal(recoveryConfig.body.keyPrefix, "fil_test_");
    const fresh = prefix => prefix + crypto.randomBytes(32).toString("base64url");
    const recoveryCode = fresh(recoveryConfig.body.codePrefix);
    const replacementKey = fresh(recoveryConfig.body.keyPrefix);
    const replacementCode = fresh(recoveryConfig.body.codePrefix);
    assert.equal((await request("/billing/recovery/enroll",{newCode:recoveryCode})).status,401);
    assert.equal((await request("/billing/recovery/enroll",{newCode:recoveryCode},token)).status,200);
    assert.equal((await request("/billing/recovery/enroll",{newCode:replacementCode},token)).status,409);
    assert.equal((await request("/billing/recovery/rotate",{code:fresh(recoveryConfig.body.codePrefix),newKey:replacementKey,newCode:replacementCode})).status,401);
    const replacements=await Promise.all([1,2].map(()=>request("/billing/recovery/rotate",{code:recoveryCode,newKey:replacementKey,newCode:replacementCode})));
    assert.deepEqual(replacements.map(x=>x.status).sort(),[200,401]);
    assert.equal((await request("/v1/usage",undefined,token)).status,401);
    token.authorization="Bearer "+replacementKey;
    assert.equal((await request("/v1/usage",undefined,token)).body.used,usage.body.used);
    assert.equal((await request("/v1/usage",undefined,token)).body.plan,usage.body.plan);
    assert.equal((await request("/billing/claim",{activationId,claimSecret})).status,410);

    const adjustment={id:"adj_fixture",transaction_id:"txn_isolated",subscription_id:"sub_isolated",customer_id:"ctm_isolated",action:"refund",type:"full",status:"pending_approval"};
    const adjustAt=n=>new Date(Date.now()+n).toISOString();
    assert.equal((await webhook("adjustment.created","evt_refund_pending",adjustment,adjustAt(20))).status,200);
    assert.equal((await request("/v1/usage",undefined,token)).body.status,"active");
    assert.equal((await webhook("adjustment.updated","evt_refund_approved",{...adjustment,status:"approved"},adjustAt(40))).status,200);
    assert.equal((await request("/v1/usage",undefined,token)).body.status,"suspended");
    assert.equal((await request("/billing/recovery/rotate",{code:replacementCode,newKey:fresh(recoveryConfig.body.keyPrefix),newCode:fresh(recoveryConfig.body.codePrefix)})).status,401);
    await webhook("adjustment.created","evt_refund_stale",adjustment,adjustAt(-1000));
    assert.equal((await request("/v1/usage",undefined,token)).body.status,"suspended");
    await webhook("transaction.completed","evt_renewal",{...purchase,id:"txn_renewal",origin:"subscription_recurring",custom_data:{}},adjustAt(1000));
    assert.equal((await request("/v1/usage",undefined,token)).body.status,"active");
    assert.equal((await request("/v1/usage",undefined,token)).body.used,usage.body.used);

    const teamChange = await webhook("subscription.updated","evt_team_not_paid",{
      id:"sub_isolated", status:"active",
      items:[{price:{id:"pri_test_team"},quantity:1}],
    },new Date(Date.now()+200).toISOString());
    assert.equal(teamChange.status,200);
    const notUpgraded = await request("/v1/usage",undefined,token);
    assert.equal(notUpgraded.body.plan,"pro");

    await webhook("transaction.completed","evt_wrong_customer_upgrade",{
      ...purchase,id:"txn_wrong_customer",customer_id:"ctm_other",custom_data:{},origin:"subscription_update",
      items:[{price:{id:"pri_test_team"},quantity:1}],details:{totals:{total:"999"}}
    });
    assert.equal((await request("/v1/usage",undefined,token)).body.plan,"pro");

    const teamPaid = await webhook("transaction.completed","evt_team_paid",{
      ...purchase, id:"txn_paid_upgrade", custom_data:{},
      items:[{price:{id:"pri_test_team"},quantity:1}],
      details:{totals:{total:"699"}},
    });
    assert.equal(teamPaid.status,200);
    const upgraded = await request("/v1/usage",undefined,token);
    assert.equal(upgraded.body.plan,"team");
    assert.equal(upgraded.body.limit,250000);
    const canceled = await webhook("subscription.canceled","evt_cancel_001",{
      id:"sub_isolated", status:"canceled",
    }, new Date(Date.now()+1000).toISOString());
    assert.equal(canceled.status,200);
    assert.equal((await request("/billing/recovery/rotate",{code:replacementCode,newKey:fresh(recoveryConfig.body.keyPrefix),newCode:fresh(recoveryConfig.body.codePrefix)})).status,401);
    const denied = await request("/v1/inspect",{format:"email",value:"user@example.com"}, token);
    assert.equal(denied.status,403);
    assert.equal(denied.body.error,"api_key_inactive");
    const stale = await webhook("subscription.updated","evt_stale_001",{
      id:"sub_isolated",status:"active",
      items:[{price:{id:"pri_test_pro"},quantity:1}],
    },new Date(Date.now()-60_000).toISOString());
    assert.equal(stale.status,200);
    assert.equal((await request("/v1/inspect",{format:"email",value:"user@example.com"},token)).status,403);
    const delayed = await webhook("transaction.completed","evt_delayed_001",purchase);
    assert.equal(delayed.status,200);
    assert.equal((await request("/v1/inspect",{format:"email",value:"user@example.com"},token)).status,403);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else { child.once("exit",resolve); setTimeout(resolve,2000).unref(); }
    });
    await rm(dir,{recursive:true,force:true});
  }
});
