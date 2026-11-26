import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=(name)=>fs.readFileSync(path.join(hostedRoot,"public",name),"utf8");
const index=read("api.html");
const terms=read("terms.html");
const privacy=read("privacy.html");
const refund=read("refund.html");
const robots=read("robots.txt");
const sitemap=read("sitemap.xml");

test("landing matches the actual product, pricing and sandbox safety",()=>{
  assert.match(index,/Format Inspector Lite/);
  assert.match(index,/\$2\.99/);
  assert.match(index,/\$6\.99/);
  assert.match(index,/<small>\/mo<\/small>/);
  assert.match(index,/Paddle is Merchant of Record/);
  assert.match(index,/ENABLE_LIVE_BILLING|Live money remains disabled/i);
  assert.match(index,/accept the .*Terms.*Refund Policy/i);
  assert.match(index,/https:\/\/format-inspector\.eztoolgo\.duckdns\.org/);
  assert.doesNotMatch(index,/WebURL Policy/i);
});

test("public legal and SEO surfaces are finalized",()=>{
  const legal=terms+"\n"+privacy+"\n"+refund;
  assert.match(legal,/MIGYEONG KIM/);
  assert.match(legal,/algorithmchoice@gmail\.com/);
  assert.match(terms,/Merchant of Record/);
  assert.match(refund,/Paddle Buyer Support/);
  assert.match(robots,/Sitemap: https:\/\/format-inspector\.eztoolgo\.duckdns\.org/);
  assert.match(sitemap,/https:\/\/format-inspector\.eztoolgo\.duckdns\.org/);
  assert.doesNotMatch(legal,/Sandbox draft|must be completed/i);
});
