import {initAdjustments,createAdjustments} from "./billing-adjustments.js";
import {renderPlans} from "./plans-ui.js";
import {initRecovery,createRecovery} from "./key-recovery.js";
import {renderSupport} from "./support.js";
import {bindBillingContext} from "./billing-context.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { inspectFormat } from "../../src/index.js";
import {
  PLAN_LIMITS,
  sha256,
  randomToken,
  validEmail,
  verifyPaddleSignature,
  pricePlan,
  paidPlanFromTransaction,
  subscriptionIsActive,
} from "./lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

// Separate public client token environments; disable all payment credentials on mismatch.
const requestedMode=process.env.PADDLE_ENV||"sandbox";
const requestedToken=process.env.PADDLE_CLIENT_TOKEN||"";
const modeAllowed=requestedMode==="sandbox"||
  (requestedMode==="live"&&process.env.ENABLE_LIVE_BILLING==="1");
const billingMode=requestedMode==="live"&&modeAllowed?"live":"sandbox";
const billingCredentialsAllowed=modeAllowed&&requestedToken.startsWith(billingMode==="live"?"live_":"test_");

const config = Object.freeze({
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  dbPath: process.env.DB_PATH || "/data/commerce.sqlite",
  baseUrl: process.env.BASE_URL || "http://localhost:8787",
  paddleEnv: billingMode,
  paddleClientToken: billingCredentialsAllowed ? (process.env.PADDLE_CLIENT_TOKEN || "") : "",
  paddleWebhookSecret: billingCredentialsAllowed ? (process.env.PADDLE_WEBHOOK_SECRET || "") : "",
  proPriceId: billingCredentialsAllowed ? (process.env.PADDLE_PRICE_PRO || "") : "",
  teamPriceId: billingCredentialsAllowed ? (process.env.PADDLE_PRICE_TEAM || "") : "",
  proMonthlyUsd: Number(process.env.PRO_MONTHLY_USD || 2.99),
  teamMonthlyUsd: Number(process.env.TEAM_MONTHLY_USD || 6.99),
  proMonthlyLimit: Number(process.env.PRO_MONTHLY_LIMIT || PLAN_LIMITS.pro),
  teamMonthlyLimit: Number(process.env.TEAM_MONTHLY_LIMIT || PLAN_LIMITS.team),
  demoDailyLimit: Number(process.env.DEMO_DAILY_LIMIT || 30),
  googleSiteVerificationFile: process.env.GOOGLE_SITE_VERIFICATION_FILE || "",
  googleSiteVerificationContent: process.env.GOOGLE_SITE_VERIFICATION_CONTENT || "",
  indexNowKey: /^[A-Za-z0-9-]{8,128}$/.test(process.env.INDEXNOW_KEY || "")
    ? process.env.INDEXNOW_KEY : "",
});

const planLimits = Object.freeze({
  pro: config.proMonthlyLimit,
  team: config.teamMonthlyLimit,
});

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
if(config.paddleEnv==="live"&&(!process.env.DB_PATH||path.resolve(config.dbPath)==="/data/commerce.sqlite"))
  throw new Error("live billing requires a separately configured database path");
const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA busy_timeout=5000");
try{bindBillingContext(db,{product:"fil",mode:config.paddleEnv,adoptLegacySandbox:process.env.ADOPT_LEGACY_SANDBOX_DB==="1"});}
catch(error){db.close();throw error;}
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  claim_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  requested_plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  api_key_plain TEXT,
  api_key_id INTEGER,
  paddle_transaction_id TEXT,
  paddle_customer_id TEXT,
  paddle_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  claim_expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  activation_id TEXT,
  paddle_customer_id TEXT,
  paddle_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_subscription
  ON api_keys(paddle_subscription_id) WHERE paddle_subscription_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS usage_monthly (
  api_key_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(api_key_id, period),
  FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS demo_usage (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(ip_hash, day)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_states (
  subscription_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  plan TEXT,
  occurred_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_transaction
  ON activations(paddle_transaction_id) WHERE paddle_transaction_id IS NOT NULL;
`);

initAdjustments(db);
const adjustments=createAdjustments(db);
initRecovery(db);
const recovery=createRecovery(db,{product:"fil",mode:config.paddleEnv,isBlocked:adjustments.isBlocked});

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function utcPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function json(res, status, value, extra = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extra,
  });
  res.end(body);
}

function text(res, status, value, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(value),
    "cache-control": "no-store",
  });
  res.end(value);
}

function securityHeaders(res) {
  // HSTS applies only to HTTPS browser responses; use a short rollout first.
  res.setHeader("strict-transport-security", "max-age=86400");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self' https://cdn.paddle.com 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://sandbox-cdn.paddle.com https://cdn.paddle.com; connect-src 'self' https://*.paddle.com; " +
      "frame-src https://*.paddle.com; img-src 'self' data: https:; form-action 'self'; base-uri 'none';"
  );
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonObject(raw) {
  try {
    const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    if(value===null||typeof value!=="object"||Array.isArray(value))throw new TypeError("object required");
    return value;
  }catch {
    const error=new Error("invalid json");error.code="INVALID_JSON";throw error;
  }
}
async function readJson(req,maxBytes){return parseJsonObject(await readBody(req,maxBytes));}

function clientIp(req) {
  // The first X-Forwarded-For entry is client-controlled; the rightmost
  // is the last proxy-observed peer when the ingress appends addresses.
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",");
  const last = forwarded[forwarded.length - 1]?.trim();
  return last && /^[0-9a-fA-F:.]+$/.test(last)
    ? last : req.socket.remoteAddress || "unknown";
}

const rateBuckets = new Map();

function allowRateLimit(bucket, key, limit, windowMs = 60_000) {
  const id = `${bucket}:${key}`;
  const now = Date.now();
  const current = rateBuckets.get(id);
  if (!current || now - current.startedAt >= windowMs) {
    if (!current && rateBuckets.size >= 20_000) return false;
    rateBuckets.set(id, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function purgeExpiredClaims() {
  db.prepare(`
    UPDATE activations
       SET api_key_plain=NULL
     WHERE api_key_plain IS NOT NULL
       AND claim_expires_at IS NOT NULL
       AND claim_expires_at < ?
  `).run(nowSeconds());
}

purgeExpiredClaims();
setInterval(() => {
  purgeExpiredClaims();
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, item] of rateBuckets) {
    if (item.startedAt < cutoff) rateBuckets.delete(id);
  }
}, 60_000).unref();

function apiKeyFromRequest(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function findApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(config.paddleEnv==="live"?"fil_live_":"fil_test_") || !/^[A-Za-z0-9_-]{1,128}$/.test(rawKey)) return null;
  const key=db.prepare(`
    SELECT id, email, plan, status, key_prefix, paddle_subscription_id
      FROM api_keys
     WHERE key_hash = ?
  `).get(sha256(rawKey)) || null;
  return key && adjustments.isBlocked(key.id) ? {...key,status:"suspended"} : key;
}

function recordUsage(keyId, limit) {
  const period = utcPeriod();
  const row = db.prepare(
    "SELECT count FROM usage_monthly WHERE api_key_id=? AND period=?"
  ).get(keyId, period);
  const current = Number(row?.count || 0);
  if (current >= limit) return { allowed: false, count: current, limit, period };
  db.prepare(`
    INSERT INTO usage_monthly(api_key_id, period, count)
    VALUES (?, ?, 1)
    ON CONFLICT(api_key_id, period) DO UPDATE SET count=count+1
  `).run(keyId, period);
  return { allowed: true, count: current + 1, limit, period };
}

function serveStatic(res, filename, contentType = "text/html; charset=utf-8", headOnly = false) {
  const full = path.join(PUBLIC_DIR, filename);
  try {
    const raw = fs.readFileSync(full);
    const body = ["index.html","try.html","api.html","review.html","automation.html"].includes(filename)
      ? Buffer.from(renderSupport(renderPlans(raw.toString("utf8"),{mode:config.paddleEnv,ready:Boolean(config.paddleClientToken&&config.proPriceId&&config.teamPriceId&&config.paddleWebhookSecret),proPrice:config.proMonthlyUsd,teamPrice:config.teamMonthlyUsd,proLimit:planLimits.pro,teamLimit:planLimits.team}), process.env.BUY_ME_A_COFFEE_USERNAME, process.env[config.paddleEnv === "live" ? "PADDLE_PORTAL_LIVE_URL" : "PADDLE_PORTAL_SANDBOX_URL"], config.paddleEnv))
      : raw;
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": "public, max-age=300",
    });
    res.end(headOnly ? undefined : body);
  } catch {
    json(res, 404, { error: "not_found" });
  }
}

function createActivation(email, plan) {
  const activationId = randomToken("act_", 18);
  const claimSecret = randomToken("claim_", 24);
  const createdAt = nowSeconds();
  db.prepare(`
    INSERT INTO activations(id, claim_hash, email, requested_plan, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(activationId, sha256(claimSecret), email.toLowerCase(), plan, createdAt);
  return { activationId, claimSecret };
}

function provisionActivation(activationId, plan, data) {
  const activation = db.prepare("SELECT * FROM activations WHERE id=?").get(activationId);
  if (!activation || activation.status !== "pending" ||
      activation.requested_plan !== plan) {
    return { ok:false, reason:"activation_missing_or_plan_mismatch" };
  }
  if (!data?.id || !data?.subscription_id || !data?.customer_id) {
    return { ok:false, reason:"payment_not_subscription" };
  }
  if (db.prepare("SELECT id FROM activations WHERE paddle_transaction_id=?").get(data.id)) {
    return { ok:false, reason:"transaction_already_assigned" };
  }
  const state = db.prepare(
    "SELECT status,plan FROM subscription_states WHERE subscription_id=?"
  ).get(data.subscription_id);
  // Preserve prior cancellation even if a delayed transaction completion arrives.
  const status = state && (state.status !== "active" || state.plan !== plan)
    ? "suspended" : "active";
  const apiKey = randomToken(config.paddleEnv === "live" ? "fil_live_" : "fil_test_", 32);
  const now = nowSeconds();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      "INSERT INTO api_keys(key_hash,key_prefix,email,plan,status,activation_id," +
      "paddle_customer_id,paddle_subscription_id,created_at,updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(sha256(apiKey), apiKey.slice(0,16), activation.email, plan,
      status, activationId, data.customer_id, data.subscription_id, now, now);
    db.prepare(
      "UPDATE activations SET status='paid',api_key_plain=?,api_key_id=?," +
      "paddle_transaction_id=?,paddle_customer_id=?,paddle_subscription_id=?," +
      "paid_at=?,claim_expires_at=? WHERE id=? AND status='pending'"
    ).run(apiKey, Number(result.lastInsertRowid), data.id, data.customer_id,
      data.subscription_id, now, now + 24*60*60, activationId);
    db.exec("COMMIT");
    return { ok:true, status };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function updateSubscription(data, occurredAt, eventType) {
  const subscriptionId = data?.id;
  const occurred = Date.parse(occurredAt);
  if (typeof subscriptionId !== "string" || !subscriptionId.startsWith("sub_") ||
      !Number.isFinite(occurred) || occurred < 0) return false;
  const prior = db.prepare(
    "SELECT occurred_at_ms FROM subscription_states WHERE subscription_id=?"
  ).get(subscriptionId);
  if (prior && occurred <= prior.occurred_at_ms) return false;

  const item = Array.isArray(data.items) && data.items.length === 1 &&
    data.items[0]?.quantity === 1 ? data.items[0] : null;
  const plan = pricePlan(item?.price?.id ?? item?.price_id, config);
  const validActive = subscriptionIsActive(data.status) &&
    !["subscription.canceled", "subscription.paused", "subscription.past_due"].includes(eventType) &&
    Boolean(plan);
  const status = validActive ? "active" : "suspended";
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO subscription_states(subscription_id,status,plan,occurred_at_ms) " +
      "VALUES (?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET " +
      "status=excluded.status,plan=excluded.plan,occurred_at_ms=excluded.occurred_at_ms"
    ).run(subscriptionId, status, plan, occurred);
    db.prepare(
      "UPDATE api_keys SET status=?, " +
      "plan=CASE WHEN plan='pro' AND ?='team' THEN plan ELSE COALESCE(?,plan) END, " +
      "updated_at=? WHERE paddle_subscription_id=?"
    ).run(status, plan, plan, nowSeconds(), subscriptionId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return true;
}

function applyVerifiedPaidUpgrade(data, plan) {
  // A signed subscription.update to Team can be scheduled without payment.
  // Never grant the higher quota until a completed nonzero Team transaction
  // exists for this exact active subscription and configured Team price.
  if (plan !== "team") return false;
  const subscriptionId = data?.subscription_id;
  const state = db.prepare(
    "SELECT status,plan FROM subscription_states WHERE subscription_id=?"
  ).get(subscriptionId);
  if (!state || state.status !== "active" || state.plan !== "team") return false;
  const result = db.prepare(
    "UPDATE api_keys SET plan='team',updated_at=? " +
    "WHERE paddle_subscription_id=? AND paddle_customer_id=? AND status='active' AND plan='pro'"
  ).run(nowSeconds(), subscriptionId, data.customer_id);
  return Number(result.changes) > 0;
}

function markWebhook(eventId, eventType) {
  db.prepare(
    "INSERT OR IGNORE INTO webhook_events(event_id,event_type,received_at) VALUES(?,?,?)"
  ).run(eventId, eventType, nowSeconds());
}

function isWebhookSeen(eventId) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM webhook_events WHERE event_id=?").get(eventId));
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

const server = http.createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:30000,keepAliveTimeout:5000,connectionsCheckingInterval:1000},async (req,res) => {
  securityHeaders(res);
  let route;
  try {route=new URL(req.url,config.baseUrl).pathname;}
  catch{return json(res,400,{error:"invalid_request_target"});}

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Bypass-resistant secondary throttle by actual socket peer, independent
    // of any client-provided forwarding header or fake IP rotation.
    if (!allowRateLimit("peer-global", req.socket.remoteAddress || "unknown", 3000)) {
      return json(res, 429, { error:"rate_limit_reached", retryAfterSeconds:60 });
    }
    if (req.method === "GET" && route === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "format-inspector-lite-cloud",
        version: "0.1.0",
        billing: {
          provider: "paddle",
          environment: config.paddleEnv,
          checkoutConfigured: Boolean(
            config.paddleClientToken && config.proPriceId && config.teamPriceId
          ),
          webhookConfigured: Boolean(config.paddleWebhookSecret),
        },
      });
    }

    if (req.method === "GET" && route === "/config.json") {
      return json(res, 200, {
        paddleEnvironment: config.paddleEnv,
        paddleClientToken: config.paddleClientToken,
        proPriceId: config.proPriceId,
        teamPriceId: config.teamPriceId,
        billingReady: Boolean(
          config.paddleClientToken &&
          config.proPriceId &&
          config.teamPriceId &&
          config.paddleWebhookSecret
        ),
        pricing: {
          pro: {
            usdMonthly: config.proMonthlyUsd,
            monthlyRequests: planLimits.pro,
          },
          team: {
            usdMonthly: config.teamMonthlyUsd,
            monthlyRequests: planLimits.team,
          },
        },
      });
    }

    if (req.method === "POST" && route === "/demo/inspect") {
      cors(res);
      const ipHash = sha256(clientIp(req));
      if (!allowRateLimit("demo", ipHash, 20)) {
        return json(res, 429, { error: "rate_limit_reached", retryAfterSeconds: 60 });
      }
      const day = utcDay();
      const body = await readJson(req, 16 * 1024);
      const usage = db.prepare(
        "SELECT count FROM demo_usage WHERE ip_hash=? AND day=?"
      ).get(ipHash, day);
      if (Number(usage?.count || 0) >= config.demoDailyLimit) {
        return json(res, 429, {
          error: "demo_limit_reached",
          dailyLimit: config.demoDailyLimit,
        });
      }
      const result = inspectFormat(body.format, body.value);
      db.prepare(`
        INSERT INTO demo_usage(ip_hash, day, count) VALUES(?,?,1)
        ON CONFLICT(ip_hash, day) DO UPDATE SET count=count+1
      `).run(ipHash, day);
      return json(res, 200, result);
    }

    if (req.method === "POST" && route === "/v1/inspect") {
      cors(res);
      const rawKey = apiKeyFromRequest(req);
      let key = findApiKey(rawKey);
      if (!key) return json(res, 401, { error: "invalid_api_key" });
      if (key.status !== "active") {
        return json(res, 403, { error: "api_key_inactive", status: key.status });
      }
      if (!allowRateLimit("paid", key.id, 600)) {
        return json(res, 429, { error: "rate_limit_reached", retryAfterSeconds: 60 });
      }
      const body = await readJson(req, 16 * 1024);
      // A slow body can span a subscription change. Recheck after the await;
      // malformed requests do not consume the paid quota.
      key = findApiKey(rawKey);
      if (!key) return json(res,401,{error:"invalid_api_key"});
      if (key.status !== "active") return json(res,403,{error:"api_key_inactive",status:key.status});
      const result = inspectFormat(body.format, body.value);
      const limit = planLimits[key.plan];
      if (!limit) return json(res, 403, { error: "unknown_plan" });
      const meter = recordUsage(key.id, limit);
      if (!meter.allowed) {
        return json(res, 429, {
          error: "monthly_limit_reached",
          period: meter.period,
          used: meter.count,
          limit: meter.limit,
        });
      }
      return json(res, 200, {
        ...result,
        usage: { period: meter.period, used: meter.count, limit: meter.limit },
      });
    }

    if (req.method === "GET" && route === "/v1/usage") {
      cors(res);
      const key = findApiKey(apiKeyFromRequest(req));
      if (!key) return json(res, 401, { error: "invalid_api_key" });
      const period = utcPeriod();
      const row = db.prepare(
        "SELECT count FROM usage_monthly WHERE api_key_id=? AND period=?"
      ).get(key.id, period);
      return json(res, 200, {
        plan: key.plan,
        status: key.status,
        period,
        used: Number(row?.count || 0),
        limit: planLimits[key.plan] || 0,
      });
    }

    if (req.method === "GET" && route === "/billing/recovery-config") {
      return json(res,200,{keyPrefix:recovery.keyPrefix,codePrefix:recovery.codePrefix});
    }
    if (req.method === "POST" && ["/billing/recovery/enroll","/billing/recovery/rotate"].includes(route)) {
      if(!allowRateLimit("recovery",sha256(clientIp(req)),10)||!allowRateLimit("recovery-peer",req.socket.remoteAddress||"unknown",100))
        return json(res,429,{error:"rate_limit_reached"});
      if(!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json"))
        return json(res,415,{error:"json_required"});
      const body=await readJson(req,4096);
      const result=route.endsWith("/enroll")?recovery.enroll(apiKeyFromRequest(req),body.newCode):recovery.rotate(body.code,body.newKey,body.newCode);
      return json(res,result.status,result.ok?{ok:true}:{error:result.error});
    }
    if (req.method === "POST" && route === "/billing/activation") {
      const ipHash = sha256(clientIp(req));
      if (!allowRateLimit("activation", ipHash, 10)) {
        return json(res, 429, { error: "rate_limit_reached", retryAfterSeconds: 60 });
      }
      const body = await readJson(req, 8 * 1024);
      const plan = body.plan;
      const email = String(body.email || "").trim();
      if (!["pro", "team"].includes(plan) || !validEmail(email)) {
        return json(res, 400, { error: "invalid_activation_request" });
      }
      if (!config.paddleClientToken || !config.paddleWebhookSecret ||
          !(plan === "pro" ? config.proPriceId : config.teamPriceId)) {
        return json(res, 503, { error:"checkout_unavailable" });
      }
      const activation = createActivation(email, plan);
      return json(res, 201, {
        ...activation,
        plan,
        paddlePriceId: plan === "pro" ? config.proPriceId : config.teamPriceId,
        billingReady: Boolean(
          config.paddleClientToken &&
          config.paddleWebhookSecret &&
          (plan === "pro" ? config.proPriceId : config.teamPriceId)
        ),
      });
    }

    if (req.method === "POST" && route === "/billing/claim") {
      const ipHash = sha256(clientIp(req));
      if (!allowRateLimit("claim", ipHash, 60)) {
        return json(res, 429, { error: "rate_limit_reached", retryAfterSeconds: 60 });
      }
      purgeExpiredClaims();
      const body = await readJson(req, 8 * 1024);
      const activationId = String(body.activationId || "");
      const claimSecret = String(body.claimSecret || "");
      const activation = db.prepare(
        "SELECT * FROM activations WHERE id=?"
      ).get(activationId);
      if (!activation || sha256(claimSecret) !== activation.claim_hash) {
        return json(res, 401, { error: "invalid_claim" });
      }
      if (activation.status !== "paid") {
        return json(res, 202, { status: activation.status });
      }
      if (!activation.api_key_plain || nowSeconds() > activation.claim_expires_at) {
        return json(res, 410, {
          error: "claim_unavailable",
          message: "This one-time claim was already used or expired. Contact support to rotate the API key.",
        });
      }
      const key = db.prepare("SELECT plan,status FROM api_keys WHERE id=?")
        .get(activation.api_key_id);
      if(adjustments.isBlocked(activation.api_key_id))return json(res,403,{error:"payment_adjustment_hold"});
      const apiKey = activation.api_key_plain;
      db.prepare(
        "UPDATE activations SET api_key_plain=NULL WHERE id=?"
      ).run(activationId);
      return json(res, 200, {
        status: "paid",
        plan: key?.plan,
        apiKey,
        apiKeyStatus: key?.status,
        claim: "one-time",
      });
    }

    if (req.method === "POST" && route === "/billing/paddle") {
      const rawBody = await readBody(req, 256 * 1024);
      if (!config.paddleWebhookSecret) {
        return json(res, 503, { error: "billing_webhook_not_configured" });
      }
      if (!verifyPaddleSignature(
        rawBody,
        req.headers["paddle-signature"],
        config.paddleWebhookSecret,
        30
      )) {
        return json(res, 401, { error: "invalid_webhook_signature" });
      }
      const event = parseJsonObject(rawBody);
      const eventId = String(event.event_id || event.id || "");
      const eventType = String(event.event_type || "");
      if (!eventId || !eventType) {
        return json(res, 400, { error: "invalid_webhook_event" });
      }
      if (isWebhookSeen(eventId)) return json(res, 200, { ok: true, duplicate: true });

      const data = event.data || {};
      if (eventType === "transaction.completed") {
        const activationId = data?.custom_data?.activation_id;
        const plan = paidPlanFromTransaction(data, config);
        if (plan) {
          if (typeof activationId === "string") provisionActivation(activationId, plan, data);
          applyVerifiedPaidUpgrade(data, plan);
          adjustments.recordPaid(data,event.occurred_at,plan);
        }
      } else if(eventType==="adjustment.created"||eventType==="adjustment.updated"){
        adjustments.recordAdjustment(data,event.occurred_at);
      } else if (
        eventType === "subscription.created" ||
        eventType === "subscription.activated" ||
        eventType === "subscription.trialing" ||
        eventType === "subscription.updated" ||
        eventType === "subscription.past_due" ||
        eventType === "subscription.canceled" ||
        eventType === "subscription.paused" ||
        eventType === "subscription.resumed"
      ) {
        updateSubscription(data, event.occurred_at, eventType);
      }
      markWebhook(eventId, eventType);
      return json(res, 200, { ok: true });
    }


    if (
      req.method === "GET" &&
      config.googleSiteVerificationFile &&
      config.googleSiteVerificationContent &&
      route === "/" + config.googleSiteVerificationFile
    ) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      return res.end(config.googleSiteVerificationContent);
    }

    if (
      req.method === "GET" &&
      config.indexNowKey &&
      route === "/" + config.indexNowKey + ".txt"
    ) {
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
      });
      return res.end(config.indexNowKey);
    }

    const isStaticRead = req.method === "GET" || req.method === "HEAD";
    const headOnly = req.method === "HEAD";
    if (isStaticRead && route === "/robots.txt") {
      return serveStatic(res, "robots.txt", "text/plain; charset=utf-8", headOnly);
    }
    if (isStaticRead && route === "/sitemap.xml") {
      return serveStatic(res, "sitemap.xml", "application/xml; charset=utf-8", headOnly);
    }
    if (isStaticRead && route === "/review") {
      res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader("referrer-policy", "no-referrer");
      return serveStatic(res, "review.html", undefined, headOnly);
    }
    if (isStaticRead && route === "/review/style.css") return serveStatic(res, "review.css", "text/css; charset=utf-8", headOnly);
    if (isStaticRead && route === "/review/tool.js") return serveStatic(res, "review.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/review/index.js") return serveStatic(res, "../../src/index.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/review/strict-json.js") return serveStatic(res, "../../src/strict-json.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/review/contract.js") return serveStatic(res, "../../src/contract.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/review/csv.js") return serveStatic(res, "../../src/csv.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && (route === "/try" || route === "/")) {
      res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader("referrer-policy", "no-referrer");
      return serveStatic(res, route === "/" ? "index.html" : "try.html", undefined, headOnly);
    }
    if (isStaticRead && route === "/try/style.css") return serveStatic(res, "try.css", "text/css; charset=utf-8", headOnly);
    if (isStaticRead && route === "/try/tool.js") return serveStatic(res, "try.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/try/core.js") return serveStatic(res, "../../src/index.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/try/strict-json.js") return serveStatic(res, "../../src/strict-json.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/try/csv.js") return serveStatic(res, "../../src/csv.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/try/convert.js") return serveStatic(res, "../../src/convert.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/landing-example.js") return serveStatic(res, "landing-example.js", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/app.js") {
      return serveStatic(res, "app.js", "application/javascript; charset=utf-8", headOnly);
    }
    if (isStaticRead && route === "/terms") return serveStatic(res, "terms.html", undefined, headOnly);
    if (isStaticRead && route === "/privacy") return serveStatic(res, "privacy.html", undefined, headOnly);
    if (isStaticRead && route === "/refund") return serveStatic(res, "refund.html", undefined, headOnly);
    if (isStaticRead && route === "/api") return serveStatic(res, "api.html", undefined, headOnly);
    if (isStaticRead && route === "/key-recovery") {
      res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader("referrer-policy","no-referrer");
      return serveStatic(res,"key-recovery.html",undefined,headOnly);
    }
    if (isStaticRead && route === "/key-recovery.js") return serveStatic(res,"key-recovery.js","text/javascript; charset=utf-8",headOnly);
    if (isStaticRead && route === "/key-backup") {
      res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader("referrer-policy", "no-referrer");
      return serveStatic(res, "key-backup.html", undefined, headOnly);
    }
    if (isStaticRead && route === "/key-backup.js") return serveStatic(res, "key-backup.js", "text/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/plans-ui.js") return serveStatic(res,"plans-ui.js","text/javascript; charset=utf-8",headOnly);
    if (isStaticRead && route === "/legal.css") return serveStatic(res,"legal.css","text/css; charset=utf-8",headOnly);
    if (isStaticRead && route === "/key-backup.css") return serveStatic(res, "key-backup.css", "text/css; charset=utf-8", headOnly);
    if (isStaticRead && route === "/automation") return serveStatic(res, "automation.html", undefined, headOnly);
    if (isStaticRead && route === "/automation.mjs") return serveStatic(res, "automation.mjs", "application/javascript; charset=utf-8", headOnly);
    if (isStaticRead && route === "/automation-example.json") return serveStatic(res, "automation-example.json", "application/json; charset=utf-8", headOnly);

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error?.code === "BODY_TOO_LARGE" ? 413 :
      error?.code === "INVALID_JSON" ? 400 : 500;
    if(status===500)console.error("request_error","internal_error");
    return json(res, status, {
      error: status === 500 ? "internal_error" : error.code.toLowerCase(),
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    event: "started",
    service: "format-inspector-lite-cloud",
    host: config.host,
    port: config.port,
    paddleEnvironment: config.paddleEnv,
    checkoutConfigured: Boolean(
      config.paddleClientToken && config.proPriceId && config.teamPriceId
    ),
    webhookConfigured: Boolean(config.paddleWebhookSecret),
  }));
});
