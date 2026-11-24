import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyPaddleCredential,
  fetchLiveReadiness,
  inspectPublicPolicies,
  summarize,
  validateDomain,
  validateLiveKey,
} from "../scripts/check-paddle-live-readiness.mjs";

const VALID_KEY = "pdl_live_apikey_" + "a".repeat(26) + "_" + "B".repeat(22) + "_" + "C".repeat(3);
const SANDBOX_KEY = "pdl_sdbx_apikey_" + "a".repeat(26) + "_" + "B".repeat(22) + "_" + "C".repeat(3);
const LEGACY_KEY = "a".repeat(50);

test("classifies Paddle credentials and checkout domain", () => {
  assert.deepEqual(validateLiveKey(VALID_KEY), {
    key: VALID_KEY,
    kind: "live_api_key",
    legacy: false,
  });
  assert.deepEqual(validateLiveKey(LEGACY_KEY), {
    key: LEGACY_KEY,
    kind: "legacy_api_key",
    legacy: true,
  });
  assert.equal(classifyPaddleCredential(SANDBOX_KEY).kind, "sandbox_api_key");
  assert.equal(classifyPaddleCredential("live_" + "A".repeat(27)).kind, "live_client_token");
  assert.equal(classifyPaddleCredential("test_" + "A".repeat(27)).kind, "sandbox_client_token");
  assert.throws(() => validateLiveKey(SANDBOX_KEY), /Sandbox API key detected/);
  assert.throws(() => validateLiveKey("live_" + "A".repeat(27)), /client-side token detected/);
  assert.throws(() => validateLiveKey("not-a-paddle-key"), /Unrecognized Paddle credential/);
  assert.equal(validateDomain("FORMAT-INSPECTOR-LITE.EXAMPLE.COM"), "format-inspector-lite.example.com");
  assert.throws(() => validateDomain("https://example.com"), /Invalid checkout domain/);
});

test("fetches account default payment link separately from the product domain", async () => {
  const calls = [];
  const responses = new Map([
    ["/verifications?verification_type=onboarding&per_page=10", {
      data: [{ verification_type: "onboarding", status: "completed", steps: [{ key: "account_setup", status: "completed" }] }],
    }],
    ["/settings/checkout-url", { data: { default_url: "https://billing.example.com/" } }],
    ["/checkout-domains?domain=format-inspector-lite.example.com&per_page=50", {
      data: [{ domain: "format-inspector-lite.example.com", status: "approved", payment_method_verification: { apple_pay: { status: "verified" } } }],
    }],
    ["/checkout-domains?domain=billing.example.com&per_page=50", {
      data: [{ domain: "billing.example.com", status: "approved" }],
    }],
  ]);
  const fakeFetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ method: options.method, path: parsed.pathname + parsed.search });
    const body = responses.get(parsed.pathname + parsed.search);
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body || {} };
  };
  const remote = await fetchLiveReadiness(VALID_KEY, "format-inspector-lite.example.com", fakeFetch);
  assert.equal(remote.onboardingStatus, "completed");
  assert.equal(remote.domainStatus, "approved");
  assert.equal(remote.defaultPaymentLinkConfigured, true);
  assert.equal(remote.defaultPaymentLinkHost, "billing.example.com");
  assert.equal(remote.defaultPaymentLinkDomainStatus, "approved");
  assert.equal(remote.defaultPaymentLinkMatchesDomain, false);
  assert.ok(calls.every((x) => x.method === "GET"));
  assert.equal(calls.length, 4);
});

test("policy inspection fails closed on sandbox placeholders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fil-live-policy-"));
  fs.writeFileSync(path.join(dir, "terms.html"), "Sandbox draft. Legal seller identity must be completed");
  fs.writeFileSync(path.join(dir, "privacy.html"), "A production privacy contact will be published");
  fs.writeFileSync(path.join(dir, "refund.html"), "This preview does not yet accept live payments");
  fs.writeFileSync(path.join(dir, "index.html"), "Sandbox");
  const policy = inspectPublicPolicies(dir);
  assert.equal(policy.finalized, false);
  assert.ok(policy.blockers.includes("legal_seller_identity_missing"));
  assert.ok(policy.blockers.includes("production_privacy_contact_missing"));
  assert.ok(policy.blockers.includes("refund_policy_still_preview"));
});

test("current public policies are finalized for live review", () => {
  const publicDir = path.resolve(new URL("../public", import.meta.url).pathname);
  const policy = inspectPublicPolicies(publicDir);
  assert.equal(policy.finalized, true);
  assert.deepEqual(policy.blockers, []);
  const combined = ["terms.html", "privacy.html", "refund.html"]
    .map((name) => fs.readFileSync(path.join(publicDir, name), "utf8"))
    .join("\n");
  assert.match(combined, /MIGYEONG KIM/);
  assert.match(combined, /algorithmchoice@gmail\.com/);
  assert.doesNotMatch(combined, /Sandbox draft/i);
});

test("summary accepts a shared approved account default payment link", () => {
  const result = summarize({
    onboardingStatus: "completed",
    onboardingSteps: [],
    domainStatus: "approved",
    applePayStatus: "verified",
    defaultPaymentLink: "https://billing.example.com/",
    defaultPaymentLinkConfigured: true,
    defaultPaymentLinkHost: "billing.example.com",
    defaultPaymentLinkDomainStatus: "approved",
    defaultPaymentLinkMatchesDomain: false,
  }, { finalized: true, blockers: [] }, "format-inspector-lite.example.com");
  assert.equal(result.readyForLiveCutover, true);
  assert.deepEqual(result.blockers, []);
});

test("summary blocks an unapproved account default payment link", () => {
  const result = summarize({
    onboardingStatus: "completed",
    onboardingSteps: [],
    domainStatus: "approved",
    applePayStatus: "verified",
    defaultPaymentLink: "https://billing.example.com/",
    defaultPaymentLinkConfigured: true,
    defaultPaymentLinkHost: "billing.example.com",
    defaultPaymentLinkDomainStatus: "pending",
    defaultPaymentLinkMatchesDomain: false,
  }, { finalized: true, blockers: [] }, "format-inspector-lite.example.com");
  assert.equal(result.readyForLiveCutover, false);
  assert.ok(result.blockers.includes("default_payment_link_domain_pending"));
});
