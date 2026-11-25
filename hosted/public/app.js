let cfg=null,activeClaim=null,checkoutReady=false,checkoutBusy=false,claimBusy=false;
const $=id=>document.getElementById(id);
const setStatus=t=>$("plan-result").textContent=t;
function showPrice(id,value){const small=document.createElement("small");small.textContent="/mo";$(id).replaceChildren(document.createTextNode(String(value)),small)}
async function loadConfig(){
 checkoutReady=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=true);
 try{
  const r=await fetch("/config.json",{cache:"no-store"}); cfg=await r.json();
  showPrice("pro-price","$"+Number(cfg.pricing.pro.usdMonthly).toFixed(2));
  showPrice("team-price","$"+Number(cfg.pricing.team.usdMonthly).toFixed(2));
  if(!cfg.billingReady||!window.Paddle){$("plan-status").textContent="Pricing preview only. Paddle sandbox catalog is not connected yet; no payment can be made.";return}
  if(cfg.paddleEnvironment==="sandbox") Paddle.Environment.set("sandbox");
  Paddle.Initialize({token:cfg.paddleClientToken,eventCallback:e=>{if(e?.name==="checkout.completed"&&activeClaim) pollClaim()}});
  try{
   const preview=await Paddle.PricePreview({items:[{priceId:cfg.proPriceId,quantity:1},{priceId:cfg.teamPriceId,quantity:1}]});
   const items=preview?.data?.details?.lineItems||preview?.data?.lineItems||[];
   const prices=new Map(items.map(item=>[item.price?.id,item.formattedTotals?.subtotal]));
   if(!prices.get(cfg.proPriceId)||!prices.get(cfg.teamPriceId))throw new Error("missing price");
   showPrice("pro-price",prices.get(cfg.proPriceId));showPrice("team-price",prices.get(cfg.teamPriceId));
  }catch{$("plan-status").textContent="Provider price verification failed; checkout paused.";return}
  checkoutReady=true;
  document.querySelectorAll(".buy").forEach(b=>b.disabled=Boolean(activeClaim));
  $("plan-status").textContent=(cfg.paddleEnvironment==="sandbox"?"Sandbox payment flow ready — test payments only":"Live payment flow configured");
 }catch(e){$("plan-status").textContent="Billing configuration unavailable"}
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
  activeClaim={activationId:a.activationId,claimSecret:a.claimSecret}; sessionStorage.setItem("fil-active-claim",JSON.stringify(activeClaim));
  Paddle.Checkout.open({items:[{priceId:a.paddlePriceId,quantity:1}],customer:{email},customData:{activation_id:a.activationId,plan:selectedPlan}});
  setStatus("Payment window opened");
 }catch{setStatus("Payment flow unavailable; check the saved claim before retrying.")}
 finally{checkoutBusy=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=!checkoutReady||Boolean(activeClaim));}
}));
async function pollClaim(){
 if(!activeClaim||claimBusy)return;
 claimBusy=true;
 try{for(let i=0;i<12;i++){
  const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(activeClaim)});
  const d=await r.json();
  if(r.status===200&&d.apiKey){const box=document.createElement("div"),label=document.createElement("strong");box.className="key";label.textContent="Copy this API key now";box.append(label,document.createElement("br"),document.createTextNode(String(d.apiKey)));$("api-key-box").replaceChildren(box);sessionStorage.removeItem("fil-active-claim");activeClaim=null;setStatus("Provisioning complete");return}
  if(r.status===410){sessionStorage.removeItem("fil-active-claim");activeClaim=null;setStatus("Claim expired or already used");return}
  await new Promise(res=>setTimeout(res,1200));
 }
 setStatus("Payment is still processing; reload to resume the saved claim");
 }catch{setStatus("Claim request unavailable; reload to resume.")}finally{claimBusy=false;document.querySelectorAll(".buy").forEach(b=>b.disabled=!checkoutReady||Boolean(activeClaim));}
}
$("run-demo").addEventListener("click",async()=>{
 try{const body={format:document.getElementById("demo-format").value,value:document.getElementById("demo-value").value};const r=await fetch("/demo/inspect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});$("demo-result").textContent=JSON.stringify(await r.json(),null,2)}catch(e){$("demo-result").textContent="Input error: "+e.message}
});
try{activeClaim=JSON.parse(sessionStorage.getItem("fil-active-claim")||"null");if(activeClaim)pollClaim()}catch{}
loadConfig();
