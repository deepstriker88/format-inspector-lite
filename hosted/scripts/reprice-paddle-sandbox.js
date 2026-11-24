import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.PADDLE_API_KEY || "";
const envPath = process.env.HOSTED_ENV_PATH || path.resolve(".env");
const API_BASE = "https://sandbox-api.paddle.com";

if (!apiKey.includes("_sdbx")) {
  throw new Error("Refusing to run: a Paddle SANDBOX API key containing _sdbx is required");
}

function readEnv(file) {
  const values = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    values.set(line.slice(0, i), line.slice(i + 1));
  }
  return values;
}

function writeEnvAtomic(file, values) {
  const content = [...values.entries()].map(([k,v]) => `${k}=${v}`).join("\n") + "\n";
  const temp = file + ".tmp";
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

async function patchPrice(priceId, cents, name) {
  if (!/^pri_[a-z0-9]{26}$/.test(priceId)) throw new Error(`invalid ${name} price id`);
  const response = await fetch(`${API_BASE}/prices/${priceId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      unit_price: { amount: String(cents), currency_code: "USD" },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Paddle price update failed for ${name}: ${payload?.error?.detail || response.status}`);
  }
  if (payload?.data?.unit_price?.amount !== String(cents)) {
    throw new Error(`Paddle did not confirm expected ${name} amount`);
  }
}

const values = readEnv(envPath);
const proId = values.get("PADDLE_PRICE_PRO") || "";
const teamId = values.get("PADDLE_PRICE_TEAM") || "";

await patchPrice(proId, 299, "pro");
await patchPrice(teamId, 699, "team");

values.set("PRO_MONTHLY_USD", "2.99");
values.set("TEAM_MONTHLY_USD", "6.99");
values.set("PRO_MONTHLY_LIMIT", "25000");
values.set("TEAM_MONTHLY_LIMIT", "250000");
writeEnvAtomic(envPath, values);

console.log(JSON.stringify({
  ok: true,
  environment: "sandbox",
  pro: { usdMonthly: 2.99, monthlyRequests: 25000 },
  team: { usdMonthly: 6.99, monthlyRequests: 250000 },
  apiKeyStored: false,
}));
