let cfg=null,activeClaim=null,checkoutReady=false,checkoutBusy=false,claimBusy=false,configBusy=false,paddleInitialized=false;
let configPromise=null;
const $=id=>document.getElementById(id);
const setStatus=t=>$("plan-result").textContent=t;
function showPrice(id,value){const small=document.createElement("small");small.textContent="/mo";$(id).replaceChildren(document.createTextNode(String(value)),small)}
function readConfig(){
 if(!configPromise)configPromise=fetch("/config.json",{cache:"no-store"}).then(async r=>{
  if(!r.ok)throw new Error("config unavailable");const data=await r.json();
  if(!["sandbox","live"].includes(data.paddleEnvironment))throw new Error("invalid billing mode");
  for(const plan of ["pro","team"]){const p=data.pricing?.[plan];if(!p||!Number.isFinite(p.usdMonthly)||p.usdMonthly<=0||!Number.isSafeInteger(p.monthlyRequests)||p.monthlyRequests<=0)throw new Error("invalid pricing");}
  return data;
 }).catch(e=>{configPromise=null;throw e});
 return configPromise;
}
async function loadConfig(){
 if(configBusy)return;configBusy=true;

 checkoutReady=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=true);
 try{
  cfg=await readConfig();
  showPrice("pro-price","$"+Number(cfg.pricing.pro.usdMonthly).toFixed(2));
  showPrice("team-price","$"+Number(cfg.pricing.team.usdMonthly).toFixed(2));
  const limits=cfg.pricing;
  $("pro-limit").textContent=Number(limits.pro.monthlyRequests).toLocaleString();
  $("team-limit").textContent=Number(limits.team.monthlyRequests).toLocaleString();
  $("checkout-fields").hidden=true;
  if(cfg.paddleEnvironment!=="live"||!cfg.billingReady){$("plan-status").textContent="Preview pricing only. Live checkout is unavailable; no real payment can be made.";return}
  if(!window.Paddle){
   await new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://cdn.paddle.com/paddle/v2/paddle.js";script.onload=resolve;script.onerror=reject;document.head.append(script);});
  }
  if(!window.Paddle)throw new Error("provider unavailable");
  if(!paddleInitialized){Paddle.Initialize({token:cfg.paddleClientToken,eventCallback:e=>{if(!activeClaim)return;if(e?.name==="checkout.completed")setStatus("Payment reported by checkout. Return and select Check pending payment.");if(e?.name==="checkout.closed"){if(!$("plans").open)$("plans").showModal();setStatus("Check pending payment before starting another purchase.")}}});paddleInitialized=true;}
  try{
   const preview=await Paddle.PricePreview({items:[{priceId:cfg.proPriceId,quantity:1},{priceId:cfg.teamPriceId,quantity:1}]});
   const items=preview?.data?.details?.lineItems||preview?.data?.lineItems||[];
   const prices=new Map(items.map(item=>[item.price?.id,item.formattedTotals?.subtotal]));
   if(!prices.get(cfg.proPriceId)||!prices.get(cfg.teamPriceId))throw new Error("missing price");
   showPrice("pro-price",prices.get(cfg.proPriceId));showPrice("team-price",prices.get(cfg.teamPriceId));
  }catch{$("plan-status").textContent="Provider price verification failed; checkout paused.";return}
  checkoutReady=true; $("checkout-fields").hidden=false;
  document.querySelectorAll(".buy").forEach(b=>b.disabled=Boolean(activeClaim));
  $("plan-status").textContent=(cfg.paddleEnvironment==="sandbox"?"Sandbox payment flow ready — test payments only":"Live payment flow configured");
 }catch(e){$("plan-status").textContent="Billing configuration unavailable"}finally{configBusy=false;}
}
document.querySelectorAll(".buy").forEach(b=>b.addEventListener("click",async()=>{
 if(!checkoutReady||checkoutBusy||activeClaim)return;
 const selectedPlan=b.dataset.plan;
 if(!["pro","team"].includes(selectedPlan))return;
 if(!$("accept-terms").checked){setStatus("Accept Terms and Refund Policy before checkout");return}
 const email=$("plan-email").value.trim();
 if(!email){setStatus("Enter an email address");return}
 checkoutBusy=true;document.querySelectorAll(".buy").forEach(b=>b.disabled=true);
 try{
  const r=await fetch("/billing/activation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,plan:selectedPlan})});
  const a=await r.json(); if(!r.ok||!a.billingReady)throw new Error(a.error||"checkout unavailable");
  activeClaim={activationId:a.activationId,claimSecret:a.claimSecret}; try{sessionStorage.setItem("fil-active-claim",JSON.stringify(activeClaim))}catch{activeClaim=null;throw new Error("Payment recovery storage unavailable")} $("resume-claim").hidden=false;
  if($("plans").open)$("plans").close();
  Paddle.Checkout.open({items:[{priceId:a.paddlePriceId,quantity:1}],customer:{email},customData:{activation_id:a.activationId,plan:selectedPlan},settings:{successUrl:window.location.origin+"/api#plans"}});
  setStatus("Payment window opened");
 }catch{if(!$("plans").open)$("plans").showModal();setStatus("Payment flow unavailable; check the saved claim before retrying.")}
 finally{checkoutBusy=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=!checkoutReady||Boolean(activeClaim));}
}));
async function pollClaim(){
 if(!activeClaim||claimBusy)return;
 claimBusy=true; $("resume-claim").disabled=true;
 try{for(let i=0;i<12;i++){
  const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(activeClaim)});
  const d=await r.json();
  if(r.status===200&&d.apiKey){const box=document.createElement("div"),label=document.createElement("strong");box.className="key";label.textContent="Copy this API key now";box.append(label,document.createElement("br"),document.createTextNode(String(d.apiKey)));$("api-key-box").replaceChildren(box);sessionStorage.removeItem("fil-active-claim");activeClaim=null;$("resume-claim").hidden=true;setStatus("Provisioning complete — save your key securely");return}
  if(r.status===403&&d.error==="payment_adjustment_hold"){setStatus("Payment is under a refund or dispute hold. Contact support with the receipt; do not buy again to resolve it.");return}
  if(r.status===410||r.status===401){sessionStorage.removeItem("fil-active-claim");activeClaim=null;$("resume-claim").hidden=true;setStatus("Claim expired or unavailable. Contact support with your receipt before purchasing again.");return}
  await new Promise(res=>setTimeout(res,1200));
 }
 setStatus("Payment is still processing; use Check pending payment before buying again");
 }catch{setStatus("Claim request unavailable; reload to resume.")}finally{claimBusy=false;$("resume-claim").disabled=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=!checkoutReady||Boolean(activeClaim));}
}
$("run-demo").addEventListener("click",async()=>{
 try{const body={format:document.getElementById("demo-format").value,value:document.getElementById("demo-value").value};const r=await fetch("/demo/inspect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});$("demo-result").textContent=JSON.stringify(await r.json(),null,2)}catch(e){$("demo-result").textContent="Input error: "+e.message}
});
try{activeClaim=JSON.parse(sessionStorage.getItem("fil-active-claim")||"null");if(activeClaim){$("plans").showModal();$("resume-claim").hidden=false;setStatus("Saved payment found. Select Check pending payment to retrieve the key.")}}catch{}
document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{
 const dialog=$(b.dataset.open);if(!dialog.open)dialog.showModal();
 if(b.dataset.open==="plans")loadConfig();
}));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));

const hasPaymentLink=/(?:^|[?&])_ptxn=txn_[a-z0-9]{26}(?:&|$)/.test(window.location?.search||"");
if (window.location?.hash === "#plans" || hasPaymentLink) {const dialog=$("plans");if(!dialog.open)dialog.showModal();loadConfig();}

$("resume-claim").addEventListener("click",pollClaim);
