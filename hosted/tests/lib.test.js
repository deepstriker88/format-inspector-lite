import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  PLAN_LIMITS,
  sha256,
  validEmail,
  verifyPaddleSignature,
  pricePlan,
  eventPriceId,
  subscriptionIsActive,
  paidPlanFromTransaction,
} from "../src/lib.js";

test("plan limits are intentionally bounded", () => {
  assert.equal(PLAN_LIMITS.pro, 25_000);
  assert.equal(PLAN_LIMITS.team, 250_000);
});

test("email validation rejects malformed input", () => {
  assert.equal(validEmail("a@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(validEmail("a @example.com"), false);
});

test("Paddle signature verifies raw body and timestamp", () => {
  const body = JSON.stringify({event_id:"evt_1",event_type:"transaction.completed"});
  const secret = "test-secret";
  const now = 1_800_000_000_000;
  const ts = Math.floor(now / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  assert.equal(
    verifyPaddleSignature(body, `ts=${ts};h1=${sig}`, secret, 30, now),
    true
  );
  assert.equal(
    verifyPaddleSignature(body + " ", `ts=${ts};h1=${sig}`, secret, 30, now),
    false
  );
  assert.equal(
    verifyPaddleSignature(body, `ts=${ts-31};h1=${sig}`, secret, 30, now),
    false
  );
});

test("price mapping trusts configured price IDs, not client plan labels", () => {
  const cfg = {proPriceId:"pri_pro",teamPriceId:"pri_team"};
  assert.equal(pricePlan("pri_pro", cfg), "pro");
  assert.equal(pricePlan("pri_team", cfg), "team");
  assert.equal(pricePlan("pri_fake", cfg), null);
});

test("event price extraction and subscription status", () => {
  assert.equal(eventPriceId({items:[{price:{id:"pri_123"}}]}), "pri_123");
  assert.equal(eventPriceId({items:[]}), null);
  assert.equal(subscriptionIsActive("active"), true);
  assert.equal(subscriptionIsActive("trialing"), false);
  assert.equal(subscriptionIsActive("canceled"), false);
});

test("paid entitlement rejects zero-cost, non-subscription, or mismatched purchases", () => {
  const cfg = { proPriceId: "pri_pro", teamPriceId: "pri_team" };
  const valid = {
    id: "txn_valid", status: "completed", collection_mode: "automatic",
    subscription_id: "sub_valid", customer_id: "ctm_valid",
    details: { totals: { total: "499" } },
    items: [{ price: { id: "pri_pro" }, quantity: 1 }],
  };
  assert.equal(paidPlanFromTransaction(valid, cfg), "pro");
  for (const bad of [
    { status: "paid" }, { status: "canceled" }, { collection_mode: "manual" },
    { subscription_id: null }, { customer_id: null },
    { details: { totals: { total: "0" } } }, { details: {} },
    { items: [{ price: { id: "pri_team" }, quantity: 2 }] },
    { items: [{ price: { id: "pri_pro" }, quantity: 1 },
              { price: { id: "pri_team" }, quantity: 1 }] },
    { items: [{ price: { id: "pri_unknown" }, quantity: 1 }] },
  ]) {
    assert.equal(paidPlanFromTransaction({ ...valid, ...bad }, cfg), null);
  }
});

test("sha256 is stable and does not retain raw key", () => {
  const raw = "wup_live_example";
  const digest = sha256(raw);
  assert.equal(digest.length, 64);
  assert.notEqual(digest, raw);
});
