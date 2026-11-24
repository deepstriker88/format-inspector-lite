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
    const headers = await fetch(base + "/healthz");
    assert.equal(headers.headers.get("strict-transport-security"), "max-age=86400");
    assert.equal(headers.headers.get("x-content-type-options"), "nosniff");
    assert.match(headers.headers.get("content-security-policy"), /style-src[^;]*https:\/\/sandbox-cdn\.paddle\.com/);
    for (const route of ["/", "/app.js", "/robots.txt", "/sitemap.xml", "/terms", "/privacy", "/refund"]) {
      const head = await fetch(base + route, { method: "HEAD" });
      assert.equal(head.status, 200, "HEAD should succeed for " + route);
      assert.ok(Number(head.headers.get("content-length")) > 0, "HEAD should expose content-length for " + route);
      assert.equal(await head.text(), "");
    }
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
    const inspected = await request("/v1/inspect", {format:"email",value:"user@example.com"}, token);
    assert.equal(inspected.status, 200);
    assert.equal(inspected.body.valid, true);
    assert.equal(inspected.body.code, "OK");
    assert.equal(inspected.body.usage.used,1);
    const usage = await request("/v1/usage", undefined, token);
    assert.equal(usage.body.used,1);
    assert.equal(usage.body.plan,"pro");

    const teamChange = await webhook("subscription.updated","evt_team_not_paid",{
      id:"sub_isolated", status:"active",
      items:[{price:{id:"pri_test_team"},quantity:1}],
    },new Date(Date.now()+200).toISOString());
    assert.equal(teamChange.status,200);
    const notUpgraded = await request("/v1/usage",undefined,token);
    assert.equal(notUpgraded.body.plan,"pro");

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
