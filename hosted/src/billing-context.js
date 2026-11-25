// An existing database must not be silently reinterpreted as another billing environment.
// This is an application consistency guard, not protection against a privileged DB editor.
export function bindBillingContext(db, {product, mode, adoptLegacySandbox=false}) {
  if(!/^(wup|fil|fpe)$/.test(product)||!["sandbox","live"].includes(mode))throw new Error("invalid billing context");
  db.exec("BEGIN IMMEDIATE");
  try{
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
    if(tables.includes("billing_context")){
      const rows=db.prepare("SELECT id,product,mode FROM billing_context").all();
      if(rows.length!==1||rows[0].id!==1||rows[0].product!==product||rows[0].mode!==mode)
        throw new Error("billing database context mismatch");
    }else{
      if(tables.length){
        if(mode!=="sandbox"||!adoptLegacySandbox||!tables.includes("api_keys"))
          throw new Error("unbound legacy billing database; reviewed sandbox adoption required");
        const prefix=product+"_test_";
        const mismatched=db.prepare("SELECT COUNT(*) n FROM api_keys WHERE key_prefix IS NULL OR substr(key_prefix,1,?)<>?").get(prefix.length,prefix).n;
        if(mismatched!==0)throw new Error("legacy API key environment mismatch");
      }
      db.exec("CREATE TABLE billing_context (id INTEGER PRIMARY KEY CHECK(id=1), product TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('sandbox','live')))");
      db.prepare("INSERT INTO billing_context(id,product,mode) VALUES(1,?,?)").run(product,mode);
    }
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}
