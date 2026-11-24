#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_BASE = "https://api.paddle.com";
const DEFAULT_DOMAIN = "format-inspector.eztoolgo.duckdns.org";
const LIVE_KEY_RE = /^pdl_live_apikey_[a-z\d]{26}_[A-Za-z\d]{22}_[A-Za-z\d]{3}$/;
const SANDBOX_KEY_RE = /^pdl_sdbx_apikey_[a-z\d]{26}_[A-Za-z\d]{22}_[A-Za-z\d]{3}$/;
const LEGACY_KEY_RE = /^[a-z0-9]{50}$/;
const CLIENT_TOKEN_RE = /^(live|test)_[A-Za-z0-9]{27}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function classifyPaddleCredential(value) {
  const key = String(value || "").trim();
  if (LIVE_KEY_RE.test(key)) return { key, kind: "live_api_key", legacy: false };
  if (SANDBOX_KEY_RE.test(key)) return { key, kind: "sandbox_api_key", legacy: false };
  if (LEGACY_KEY_RE.test(key)) return { key, kind: "legacy_api_key", legacy: true };
  if (CLIENT_TOKEN_RE.test(key)) {
    return {
      key,
      kind: key.startsWith("live_") ? "live_client_token" : "sandbox_client_token",
      legacy: false,
    };
  }
  return { key, kind: "unknown", legacy: false };
}

export function validateLiveKey(value) {
  const credential = classifyPaddleCredential(value);
  if (credential.kind === "live_api_key" || credential.kind === "legacy_api_key") {
    return credential;
  }
  if (credential.kind === "sandbox_api_key") {
    throw new Error(
      "Sandbox API key detected (pdl_sdbx_apikey_...). Live readiness requires a Live API key from the Paddle Live workspace."
    );
  }
  if (credential.kind === "live_client_token" || credential.kind === "sandbox_client_token") {
    throw new Error(
      "Paddle.js client-side token detected. This checker requires a server-side Paddle API key, not a client-side token."
    );
  }
  throw new Error(
    "Unrecognized Paddle credential. Create/copy a Paddle Live API key from My account > Settings > Authentication > API keys."
  );
}

export function validateDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!HOST_RE.test(domain)) throw new Error("Invalid checkout domain.");
  return domain;
}

async function paddleGet(apiPath, key, fetchImpl) {
  const response = await fetchImpl(API_BASE + apiPath, {
    method: "GET",
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "user-agent": "format-inspector-lite-cloud-live-readiness/1.0",
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Avoid echoing arbitrary HTML/error bodies into CI or terminal output.
  }
  if (!response.ok) {
    const code = payload?.error?.code || `http_${response.status}`;
    const detail = payload?.error?.detail || "Paddle API request failed";
    const error = new Error(`${code}: ${detail}`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return payload;
}

export async function fetchLiveReadiness(key, domain, fetchImpl = fetch) {
  const [verification, domains, checkout] = await Promise.all([
    paddleGet("/verifications?verification_type=onboarding&per_page=10", key, fetchImpl),
    paddleGet(`/checkout-domains?domain=${encodeURIComponent(domain)}&per_page=50`, key, fetchImpl),
    paddleGet("/settings/checkout-url", key, fetchImpl),
  ]);

  const onboarding = Array.isArray(verification.data)
    ? verification.data.find((item) => item?.verification_type === "onboarding")
    : null;
  const domainRecord = Array.isArray(domains.data)
    ? domains.data.find((item) => String(item?.domain || "").toLowerCase() === domain)
    : null;
  const defaultUrl = String(checkout?.data?.default_url || "");
  let defaultHost = "";
  try {
    defaultHost = new URL(defaultUrl).hostname.toLowerCase();
  } catch {
    defaultHost = "";
  }

  return {
    onboardingStatus: onboarding?.status || "missing",
    onboardingSteps: Array.isArray(onboarding?.steps)
      ? onboarding.steps.map((step) => ({ key: step.key, status: step.status }))
      : [],
    domainStatus: domainRecord?.status || "missing",
    applePayStatus: domainRecord?.payment_method_verification?.apple_pay?.status || "unknown",
    defaultPaymentLink: defaultUrl || null,
    defaultPaymentLinkMatchesDomain: defaultHost === domain,
  };
}

export function inspectPublicPolicies(publicDir) {
  const read = (name) => fs.readFileSync(path.join(publicDir, name), "utf8");
  const terms = read("terms.html");
  const privacy = read("privacy.html");
  const refund = read("refund.html");
  const index = read("index.html");
  const combined = [terms, privacy, refund, index].join("\n").toLowerCase();

  const blockers = [];
  if (combined.includes("sandbox draft")) blockers.push("policy_pages_still_marked_sandbox_draft");
  if (terms.toLowerCase().includes("legal seller identity") &&
      terms.toLowerCase().includes("must be completed")) {
    blockers.push("legal_seller_identity_missing");
  }
  if (privacy.toLowerCase().includes("production privacy contact will be published")) {
    blockers.push("production_privacy_contact_missing");
  }
  if (refund.toLowerCase().includes("preview does not yet accept live payments")) {
    blockers.push("refund_policy_still_preview");
  }
  return {
    finalized: blockers.length === 0,
    blockers,
  };
}

export function summarize(remote, policies, domain) {
  const blockers = [];
  if (remote.onboardingStatus !== "completed") {
    blockers.push(`paddle_onboarding_${remote.onboardingStatus}`);
  }
  if (remote.domainStatus !== "approved") {
    blockers.push(`checkout_domain_${remote.domainStatus}`);
  }
  if (!remote.defaultPaymentLinkMatchesDomain) {
    blockers.push("default_payment_link_not_on_approved_domain");
  }
  blockers.push(...policies.blockers);

  return {
    environment: "live-readiness-check",
    domain,
    readyForLiveCutover: blockers.length === 0,
    paddle: remote,
    publicPolicies: policies,
    blockers,
    requiredKeyPermissions: [
      "verification.read",
      "checkout_domain.read",
      "checkout_settings.read",
    ],
    note: "Read-only check. This script never creates products, changes settings, or stores the API key.",
  };
}

export async function main(argv = process.argv.slice(2), fetchImpl = fetch) {
  const domainArgIndex = argv.indexOf("--domain");
  const domain = validateDomain(
    domainArgIndex >= 0 ? argv[domainArgIndex + 1] : DEFAULT_DOMAIN
  );
  const credential = validateLiveKey(process.env.PADDLE_LIVE_API_KEY);
  const remote = await fetchLiveReadiness(credential.key, domain, fetchImpl);
  const publicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../public"
  );
  const policies = inspectPublicPolicies(publicDir);
  const result = summarize(remote, policies, domain);
  result.credential = {
    kind: credential.kind,
    legacy: credential.legacy,
    warning: credential.legacy
      ? "Legacy Paddle API key accepted for diagnosis only. Replace it with a current-format least-privilege Live API key."
      : null,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.readyForLiveCutover ? 0 : 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      const safe = String(error?.message || error).replace(/pdl_[A-Za-z0-9_]+/g, "[REDACTED]");
      process.stderr.write(`PADDLE_LIVE_READINESS_ERROR: ${safe}\n`);
      process.exitCode = 2;
    }
  );
}
