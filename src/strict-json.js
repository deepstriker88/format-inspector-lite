// Bounded JSON parsing for explicit review inputs; reject ambiguous keys.
export function strictJson(text,{maxBytes=1048576,maxDepth=64,maxNodes=100000,integerLexemesOnly=false}={}){
  if(typeof text!=="string"||text.length>maxBytes||new TextEncoder().encode(text).length>maxBytes)throw new RangeError("JSON input too large");
  let i=0,nodes=0;
  const ws=()=>{while(i<text.length&&/[\t\n\r ]/.test(text[i]))i++;};
  const invalid=()=>{throw new SyntaxError('Invalid or ambiguous JSON');};
  function string(){
    if(text[i]!=='"')invalid();
    const start=i++;
    while(i<text.length){
      const c=text[i++];
      if(c==='"')return JSON.parse(text.slice(start,i));
      if(c==='\\'){if(i>=text.length)invalid();i++;}
    }
    invalid();
  }
  function value(depth){
    if(depth>maxDepth||++nodes>maxNodes)throw new RangeError('JSON structure exceeds limits');
    ws();
    const c=text[i];
    if(c==='{'){
      const keys=new Set();i++;ws();
      if(text[i]==='}'){i++;return;}
      for(;;){
        ws();const k=string();
        if(keys.has(k))throw new SyntaxError('Duplicate JSON object key');
        keys.add(k);ws();if(text[i++]!==':')invalid();
        value(depth+1);ws();const end=text[i++];
        if(end==='}')return;if(end!==',')invalid();
      }
    }
    if(c==='['){
      i++;ws();if(text[i]===']'){i++;return;}
      for(;;){value(depth+1);ws();const end=text[i++];if(end===']')return;if(end!==',')invalid();}
    }
    if(c==='"'){string();return;}
    const start=i;
    while(i<text.length&&!/[\t\n\r ,}\]]/.test(text[i]))i++;
    if(i===start)invalid();
    const lexeme=text.slice(start,i);
    const scalar=JSON.parse(lexeme);
    if(integerLexemesOnly&&typeof scalar==='number'&&(!/^-?(?:0|[1-9][0-9]*)$/.test(lexeme)||lexeme==='-0'||!Number.isSafeInteger(scalar)))throw new RangeError('Canonical safe integer required');
    if(typeof scalar==='number'&&!Number.isFinite(scalar))throw new RangeError('Non-finite JSON number');
    if(scalar!==null&&typeof scalar==='object')invalid();
  }
  value(0);ws();if(i!==text.length)invalid();
  return JSON.parse(text);
}
