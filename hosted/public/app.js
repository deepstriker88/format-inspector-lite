let cfg=null,activeClaim=null,selectedPlan=null;
const $=id=>document.getElementById(id);
const setStatus=t=>$("plan-result").textContent=t;
async function loadConfig(){
 try{
  const r=await fetch("/config.json",{cache:"no-store"}); cfg=await r.json();
  $("pro-price").innerHTML="$"+Number(cfg.pricing.pro.usdMonthly).toFixed(2)+"<small>/mo</small>";
  $("team-price").innerHTML="$"+Number(cfg.pricing.team.usdMonthly).toFixed(2)+"<small>/mo</small>";
  if(!cfg.billingReady||!window.Paddle){$("plan-status").textContent="Pricing preview only. Paddle sandbox catalog is not connected yet; no payment can be made.";return}
  if(cfg.paddleEnvironment==="sandbox") Paddle.Environment.set("sandbox");
  Paddle.Initialize({token:cfg.paddleClientToken,eventCallback:e=>{if(e?.name==="checkout.completed"&&activeClaim) pollClaim()}});
  try{
   const preview=await Paddle.PricePreview({items:[{priceId:cfg.proPriceId,quantity:1},{priceId:cfg.teamPriceId,quantity:1}]});
   const items=preview?.data?.details?.lineItems||preview?.data?.lineItems||[];
   for(const item of items){if(item.price?.id===cfg.proPriceId&&item.formattedTotals?.subtotal)$("pro-price").innerHTML=item.formattedTotals.subtotal+"<small>/mo</small>";if(item.price?.id===cfg.teamPriceId&&item.formattedTotals?.subtotal)$("team-price").innerHTML=item.formattedTotals.subtotal+"<small>/mo</small>"}
  }catch{}
  document.querySelectorAll(".buy").forEach(b=>b.disabled=false);
  $("plan-status").textContent=(cfg.paddleEnvironment==="sandbox"?"Sandbox payment flow ready — test payments only":"Live payment flow configured");
 }catch(e){$("plan-status").textContent="Billing configuration unavailable"}
}
document.querySelectorAll(".buy").forEach(b=>b.addEventListener("click",async()=>{
 selectedPlan=b.dataset.plan;
 if(!$("accept-terms").checked){setStatus("Accept Terms and Refund Policy before checkout");return}
 const email=$("plan-email").value.trim();
 if(!email){setStatus("Enter an email address");return}
 try{
  const r=await fetch("/billing/activation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,plan:selectedPlan})});
  const a=await r.json(); if(!r.ok||!a.billingReady)throw new Error(a.error||"checkout unavailable");
  activeClaim={activationId:a.activationId,claimSecret:a.claimSecret}; sessionStorage.setItem("fil-active-claim",JSON.stringify(activeClaim));
  Paddle.Checkout.open({items:[{priceId:a.paddlePriceId,quantity:1}],customer:{email},customData:{activation_id:a.activationId,plan:selectedPlan}});
  setStatus("Payment window opened");
 }catch(e){setStatus("Payment flow unavailable: "+e.message)}
}));
async function pollClaim(){
 if(!activeClaim)return;
 for(let i=0;i<12;i++){
  const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(activeClaim)});
  const d=await r.json();
  if(r.status===200&&d.apiKey){$("api-key-box").innerHTML='<div class="key"><strong>Copy this API key now</strong><br>'+d.apiKey+'</div>';sessionStorage.removeItem("fil-active-claim");activeClaim=null;setStatus("Provisioning complete");return}
  if(r.status===410){setStatus("Claim expired or already used");return}
  await new Promise(res=>setTimeout(res,1200));
 }
 setStatus("Payment is still processing; reload to resume the saved claim");
}
$("run-demo").addEventListener("click",async()=>{
 try{const body={format:document.getElementById("demo-format").value,value:document.getElementById("demo-value").value};const r=await fetch("/demo/inspect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});$("demo-result").textContent=JSON.stringify(await r.json(),null,2)}catch(e){$("demo-result").textContent="Input error: "+e.message}
});
try{activeClaim=JSON.parse(sessionStorage.getItem("fil-active-claim")||"null");if(activeClaim)pollClaim()}catch{}
loadConfig();
