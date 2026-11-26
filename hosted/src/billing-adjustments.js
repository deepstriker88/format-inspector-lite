// Signed provider events only. Ledger retains identifiers/status, not payloads or card data.
const id=(v,p)=>typeof v==="string"&&v.startsWith(p)&&/^[A-Za-z0-9_]{5,128}$/.test(v);
const at=v=>{const n=Date.parse(v);return Number.isFinite(n)&&n>=0?n:null};
export function initAdjustments(db){
 db.exec("CREATE TABLE IF NOT EXISTS paid_entitlement_transactions(transaction_id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL,customer_id TEXT NOT NULL,occurred_at_ms INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS idx_entitlement_latest ON paid_entitlement_transactions(subscription_id,customer_id,occurred_at_ms DESC);CREATE TABLE IF NOT EXISTS billing_adjustments(adjustment_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,subscription_id TEXT NOT NULL,customer_id TEXT NOT NULL,action TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,occurred_at_ms INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS idx_adjustment_transaction ON billing_adjustments(transaction_id,subscription_id,customer_id);CREATE INDEX IF NOT EXISTS idx_adjustment_activation_key ON activations(api_key_id)");
}
export function createAdjustments(db){
 const actions=new Set(["credit","refund","chargeback","chargeback_reverse","chargeback_warning","chargeback_warning_reverse","credit_reverse"]);
 const statuses=new Set(["pending_approval","approved","rejected","reversed"]);
 return {
  // Called only after paid-plan verification; an initial payment must be linked
  // to its activation, a renewal/update to an existing exact customer+subscription.
  recordPaid(data,occurredAt,plan){
   const t=at(occurredAt);
   if(t===null||!id(data?.id,"txn_")||!id(data?.subscription_id,"sub_")||!id(data?.customer_id,"ctm_"))return false;
   const initial=db.prepare("SELECT 1 FROM activations WHERE paddle_transaction_id=? AND paddle_subscription_id=? AND paddle_customer_id=? AND status='paid' AND requested_plan=?").get(data.id,data.subscription_id,data.customer_id,plan);
   const renewal=["subscription_recurring","subscription_update"].includes(data.origin)&&db.prepare("SELECT 1 FROM api_keys WHERE paddle_subscription_id=? AND paddle_customer_id=? AND plan=?").get(data.subscription_id,data.customer_id,plan);
   if(!initial&&!renewal)return false;
   return Number(db.prepare("INSERT OR IGNORE INTO paid_entitlement_transactions VALUES(?,?,?,?)").run(data.id,data.subscription_id,data.customer_id,t).changes)===1;
  },
  recordAdjustment(data,occurredAt){
   const t=at(occurredAt);
   if(t===null||!id(data?.id,"adj_")||!id(data?.transaction_id,"txn_")||!id(data?.subscription_id,"sub_")||!id(data?.customer_id,"ctm_")||!actions.has(data.action)||!statuses.has(data.status)||!["full","partial",null].includes(data.type))return false;
   // Updates for an adjustment cannot change its immutable identity. Delayed
   // events are ignored, and equal timestamps cannot reopen a settled event.
   const q=db.prepare("INSERT INTO billing_adjustments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(adjustment_id) DO UPDATE SET status=excluded.status,occurred_at_ms=excluded.occurred_at_ms WHERE billing_adjustments.transaction_id=excluded.transaction_id AND billing_adjustments.subscription_id=excluded.subscription_id AND billing_adjustments.customer_id=excluded.customer_id AND billing_adjustments.action=excluded.action AND billing_adjustments.kind=excluded.kind AND excluded.occurred_at_ms>billing_adjustments.occurred_at_ms AND (billing_adjustments.status='pending_approval' OR (billing_adjustments.status='approved' AND excluded.status='reversed'))");
   return Number(q.run(data.id,data.transaction_id,data.subscription_id,data.customer_id,data.action,data.type||"unspecified",data.status,t).changes)===1;
  },
  isBlocked(keyId){
   const k=db.prepare("SELECT paddle_subscription_id s,paddle_customer_id c FROM api_keys WHERE id=?").get(keyId);
   if(!k?.s||!k?.c)return false;
   // Most recent verified transaction, with an initial activation fallback
   // for databases created before this ledger. A past-period refund does not
   // suspend a newer verified renewal. Same-time candidates are conservative.
   const latest=db.prepare("SELECT max(occurred_at_ms) t FROM paid_entitlement_transactions WHERE subscription_id=? AND customer_id=?").get(k.s,k.c).t;
   if(latest!==null){
    return Boolean(db.prepare("SELECT 1 FROM paid_entitlement_transactions p JOIN billing_adjustments a ON a.transaction_id=p.transaction_id AND a.subscription_id=p.subscription_id AND a.customer_id=p.customer_id WHERE p.subscription_id=? AND p.customer_id=? AND p.occurred_at_ms=? AND a.status='approved' AND (a.action='chargeback' OR (a.action='refund' AND a.kind='full')) LIMIT 1").get(k.s,k.c,latest));
   }
   return Boolean(db.prepare("SELECT 1 FROM activations p JOIN billing_adjustments a ON a.transaction_id=p.paddle_transaction_id AND a.subscription_id=p.paddle_subscription_id AND a.customer_id=p.paddle_customer_id WHERE p.api_key_id=? AND p.status='paid' AND a.status='approved' AND (a.action='chargeback' OR (a.action='refund' AND a.kind='full')) LIMIT 1").get(keyId));
  }
 };
}
