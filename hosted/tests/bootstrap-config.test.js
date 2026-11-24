import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const script=fs.readFileSync(path.join(hostedRoot,"scripts/bootstrap-paddle-sandbox.js"),"utf8");

test("sandbox bootstrap preserves an existing account-level default payment link",()=>{
  assert.match(script,/checkout_settings\.read/);
  assert.match(script,/existingCheckoutUrl = await paddle\("GET", "\/settings\/checkout-url"\)/);
  assert.match(script,/if \(!existingCheckoutUrl\?\.default_url\)/);
  assert.match(script,/defaultPaymentLinkChanged/);
});
