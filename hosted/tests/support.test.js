import test from "node:test";
import assert from "node:assert/strict";
import {supportLink,renderSupport} from "../src/support.js";
test("voluntary support is absent until a valid account is configured",()=>{
 const html='start<!-- optional-support -->end';
 assert.equal(renderSupport(html,undefined),"startend");
 for(const value of ["","<script>","https://other.invalid","abc/def","abc?x=y","abc\n","a".repeat(41)])assert.equal(supportLink(value),"");
 const link=supportLink("synthetic_fixture");
 assert.match(link,/href="https:\/\/buymeacoffee\.com\/synthetic_fixture"/);
 assert.doesNotMatch(link,/<script|<iframe|<img/);
 assert.equal(renderSupport(html,"synthetic_fixture"),"start"+link+"end");
});
