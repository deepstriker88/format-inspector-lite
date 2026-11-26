// Server-rendered, bounded plan preview. No input, provider calls, or client secrets.
export function renderPlans(html,{mode,ready,proPrice,teamPrice,proLimit,teamLimit}){
 if(!html.includes("<!-- ez-plans -->"))return html;
 const money=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100000?"$"+n.toFixed(2):"Not configured";
 const count=n=>Number.isSafeInteger(n)&&n>0?n.toLocaleString("en-US"):"Not configured";
 const status=mode!=="live"?"Preview pricing · real-money payments are not enabled.":ready?"Monthly subscription · final total at checkout.":"Paid checkout is currently unavailable.";
 const row=(name,desc,price)=>'<div class="ez-row"><span><strong>'+name+'</strong><small>'+desc+'</small></span><strong>'+price+'</strong></div>';
 const markup='<dialog class="ez-plans" id="ez-plans" aria-labelledby="ez-plans-title"><div class="ez-head"><h2 id="ez-plans-title">API plans</h2><button type="button" autofocus>Close</button></div><p>Free browser checks stay free. No account needed.</p>'+row("Free","Local browser and npm","$0")+row("Pro",count(proLimit)+" API calls / month",money(proPrice)+"/mo")+row("Team",count(teamLimit)+" API calls / month",money(teamPrice)+"/mo")+'<p>'+status+'</p><a class="ez-continue" href="/api#plans" target="_blank" rel="noopener">Billing &amp; subscription details ↗</a><div class="ez-links"><a href="/key-recovery" target="_blank" rel="noopener noreferrer" aria-label="Recover API key (opens in new tab)">Recover API key ↗</a><a href="/key-backup" target="_blank" rel="noopener noreferrer" aria-label="Key backup (opens in new tab)">Key backup ↗</a><!-- optional-support --></div></dialog><script src="/plans-ui.js" defer></script>';
 return html.replace("<!-- ez-plans -->",markup);
}
