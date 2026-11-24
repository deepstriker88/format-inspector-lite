import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://sandbox-api.paddle.com";
const apiKey = process.env.PADDLE_API_KEY || "";
const envPath = process.env.HOSTED_ENV_PATH || path.resolve(".env");

if (!apiKey.includes("_sdbx")) {
  throw new Error("Refusing to run: a Paddle SANDBOX API key containing _sdbx is required");
}

const requiredPermissions = [
  "product.write",
  "price.write",
  "client_token.write",
  "notification_setting.write",
  "checkout_settings.read",
  "checkout_settings.write",
];

async function paddle(method, route, body) {
  const response = await fetch(API_BASE + route, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.detail || payload?.error?.code || response.statusText;
    throw new Error(`Paddle ${method} ${route} failed (${response.status}): ${detail}`);
  }
  return payload.data;
}

function readEnv(file) {
  const values = new Map();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function writeEnvAtomic(file, updates) {
  const values = readEnv(file);
  for (const [key, value] of Object.entries(updates)) values.set(key, value);
  values.set("PADDLE_ENV", "sandbox");
  values.set("ENABLE_TEST_ADMIN", "0");
  values.delete("ADMIN_TOKEN");

  const content = [...values.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";

  const temp = file + ".tmp";
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

async function main() {
  console.log("Paddle sandbox bootstrap: creating isolated test catalog");

  const product = await paddle("POST", "/products", {
    name: "Format Inspector Lite Cloud",
    description: "Hosted format validation API with managed API keys and usage quotas.",
    tax_category: "saas",
    custom_data: { service: "format-inspector-lite-cloud", environment: "sandbox" },
  });

  const pro = await paddle("POST", "/prices", {
    product_id: product.id,
    name: "Pro monthly",
    description: "Format Inspector Lite Cloud Pro monthly subscription",
    billing_cycle: { interval: "month", frequency: 1 },
    unit_price: { amount: "299", currency_code: "USD" },
    quantity: { minimum: 1, maximum: 1 },
  });

  const team = await paddle("POST", "/prices", {
    product_id: product.id,
    name: "Team monthly",
    description: "Format Inspector Lite Cloud Team monthly subscription",
    billing_cycle: { interval: "month", frequency: 1 },
    unit_price: { amount: "699", currency_code: "USD" },
    quantity: { minimum: 1, maximum: 1 },
  });

  const clientToken = await paddle("POST", "/client-tokens", {
    name: "Format Inspector Lite Cloud sandbox checkout",
    description: "Paddle.js token for https://format-inspector.eztoolgo.duckdns.org",
  });

  const existingCheckoutUrl = await paddle("GET", "/settings/checkout-url");
  let checkoutUrl = existingCheckoutUrl;
  let defaultPaymentLinkChanged = false;
  if (!existingCheckoutUrl?.default_url) {
    checkoutUrl = await paddle("PATCH", "/settings/checkout-url", {
      default_url: "https://format-inspector.eztoolgo.duckdns.org",
    });
    defaultPaymentLinkChanged = true;
  }

  const notification = await paddle("POST", "/notification-settings", {
    description: "Format Inspector Lite Cloud sandbox entitlement webhook",
    type: "url",
    destination: "https://format-inspector.eztoolgo.duckdns.org/billing/paddle",
    include_sensitive_fields: false,
    traffic_source: "platform",
    subscribed_events: [
      "transaction.completed",
      "subscription.created",
      "subscription.activated",
      "subscription.trialing",
      "subscription.updated",
      "subscription.past_due",
      "subscription.paused",
      "subscription.resumed",
      "subscription.canceled",
    ],
  });

  if (!clientToken?.token?.startsWith("test_")) {
    throw new Error("Paddle returned an unexpected non-sandbox client token");
  }
  if (!pro?.id?.startsWith("pri_") || !team?.id?.startsWith("pri_")) {
    throw new Error("Paddle did not return expected price IDs");
  }
  if (!notification?.endpoint_secret_key) {
    throw new Error("Paddle did not return a webhook endpoint secret");
  }

  writeEnvAtomic(envPath, {
    PADDLE_CLIENT_TOKEN: clientToken.token,
    PADDLE_PRICE_PRO: pro.id,
    PADDLE_PRICE_TEAM: team.id,
    PADDLE_WEBHOOK_SECRET: notification.endpoint_secret_key,
    PRO_MONTHLY_USD: "2.99",
    TEAM_MONTHLY_USD: "6.99",
    PRO_MONTHLY_LIMIT: "25000",
    TEAM_MONTHLY_LIMIT: "250000",
  });

  console.log(JSON.stringify({
    ok: true,
    environment: "sandbox",
    productId: product.id,
    proPriceId: pro.id,
    teamPriceId: team.id,
    webhookDestinationId: notification.id,
    defaultPaymentLink: checkoutUrl.default_url,
    defaultPaymentLinkChanged,
    clientTokenCreated: true,
    webhookSecretStored: true,
    apiKeyStored: false,
    envPath,
    requiredPermissions,
  }));
}

main().catch((error) => {
  console.error(error.message);
  console.error("Required API-key permissions:", requiredPermissions.join(", "));
  process.exitCode = 1;
});
