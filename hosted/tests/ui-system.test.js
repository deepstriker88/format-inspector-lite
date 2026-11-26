import test from "node:test";
import assert from "node:assert/strict";
import {renderPlans} from "../src/plans-ui.js";
import fs from "node:fs";
test("preview is local, prices come from validated configuration, no credential data",()=>{
 const s=renderPlans("a<!-- ez-plans -->b",{mode:"sandbox",ready:true,proPrice:4.99,teamPrice:9.99,proLimit:100000,teamLimit:1000000});
 assert.match(s,/id="ez-plans"/);assert.match(s,/\$4.99/);assert.match(s,/1,000,000/);assert.match(s,/real-money payments are not enabled/);assert.match(s,/target="_blank" rel="noopener"/);
 assert.doesNotMatch(s,/cdn.paddle|fetch\(|<form|<input|<iframe/);
 const bad=renderPlans("<!-- ez-plans -->",{mode:"<script>",proPrice:"<script>",teamPrice:NaN,proLimit:-1,teamLimit:Infinity});
 assert.doesNotMatch(bad,/<script>/);assert.match(bad,/Not configured/);
 assert.equal(renderPlans("unchanged",{}),"unchanged");
});
test("all rendered documents share the canonical palette and legal heading contrast",()=>{
 const pub=new URL("../public/",import.meta.url);
 const t=fs.readFileSync(new URL("try.css",pub),"utf8").split("\n")[0];
 for(const f of ["review.css","legal.css","key-backup.css","api.html"])assert.ok(fs.readFileSync(new URL(f,pub),"utf8").includes(t),f);
 for(const f of ["terms.html","privacy.html","refund.html"]){const h=fs.readFileSync(new URL(f,pub),"utf8");assert.match(h,/href="\/legal.css"/);assert.doesNotMatch(h,/color:#ffffff/)}
});
