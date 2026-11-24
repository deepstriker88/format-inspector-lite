import crypto from "node:crypto";

export const PLAN_LIMITS = Object.freeze({
  pro: 25_000,
  team: 250_000,
});

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function randomToken(prefix, bytes = 24) {
  return prefix + crypto.randomBytes(bytes).toString("base64url");
}

export function validEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function verifyPaddleSignature(rawBody, header, secret, toleranceSeconds = 300, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.create(null);
  for (const item of String(header).split(";")) {
    const [key, value] = item.split("=", 2);
    if (!key || !value) continue;
    (parts[key] ??= []).push(value);
  }
  const ts = Number(parts.ts?.[0]);
  const signatures = parts.h1 ?? [];
  if (!Number.isFinite(ts) || signatures.length === 0) return false;
  const age = Math.abs(Math.floor(now / 1000) - ts);
  if (age > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}:${rawBody}`, "utf8")
    .digest("hex");
  return signatures.some((signature) => {
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(signature, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

export function pricePlan(priceId, config) {
  if (priceId && priceId === config.proPriceId) return "pro";
  if (priceId && priceId === config.teamPriceId) return "team";
  return null;
}

export function eventPriceId(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items) {
    const id = item?.price?.id ?? item?.price_id;
    if (typeof id === "string" && id.startsWith("pri_")) return id;
  }
  return null;
}

export function subscriptionIsActive(status) {
  // A trial is not a successful paid purchase.
  return status === "active";
}

export function paidPlanFromTransaction(data, config) {
  // Must be called only after signature verification of the webhook.
  // A price ID by itself does not establish a paid recurring subscription.
  if (data?.status !== "completed" ||
      data?.collection_mode !== "automatic" ||
      typeof data?.id !== "string" || !data.id.startsWith("txn_") ||
      typeof data?.subscription_id !== "string" || !data.subscription_id.startsWith("sub_") ||
      typeof data?.customer_id !== "string" || !data.customer_id.startsWith("ctm_") ||
      !Array.isArray(data?.items) || data.items.length !== 1 ||
      data.items[0].quantity !== 1) return null;
  const total = data?.details?.totals?.total;
  if (typeof total !== "string" || !/^[0-9]+$/.test(total) || BigInt(total) <= 0n) {
    return null;
  }
  const priceId = data.items[0]?.price?.id ?? data.items[0]?.price_id;
  return pricePlan(priceId, config);
}
