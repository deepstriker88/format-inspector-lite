import {inspectFormat,explainResult} from "/try/core.js";
const examples={bad:["email","not-an-email"],good:["email","user@example.com"],ip:["ipv4","999.1.2.3"]};
function check(k){const [f,v]=examples[k];const r=inspectFormat(f,v);return {ok:r.valid,text:(r.valid?"Valid format: ":"Needs attention: ")+v+" — "+explainResult(r)};}
const select=document.getElementById("sample-select"),button=document.getElementById("sample-run"),output=document.getElementById("sample-output");
button.addEventListener("click",()=>{try{const r=check(select.value);output.textContent=r.text;output.dataset.state=r.ok?"pass":"fail";}catch{output.textContent="Example could not be checked.";output.dataset.state="fail";}});
select.addEventListener("change",()=>{output.textContent="Run the selected example.";delete output.dataset.state;});
button.disabled=false;
