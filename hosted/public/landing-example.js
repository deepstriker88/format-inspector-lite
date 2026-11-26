import {inspectFormat,explainResult} from "/try/core.js";
const examples={bad:["email","not-an-email"],good:["email","user@example.com"],ip:["ipv4","999.1.2.3"]};
function check(k){const [f,v]=examples[k];const r=inspectFormat(f,v);return {ok:r.valid,text:(r.valid?"Valid format: ":"Needs attention: ")+v+" — "+explainResult(r)};}
const select=document.getElementById("sample-select"),button=document.getElementById("sample-run"),output=document.getElementById("sample-output");
function renderExample(){try{const r=check(select.value);output.textContent=r.text;output.dataset.state=r.ok?"pass":"fail";}catch{output.textContent="Example could not be checked.";output.dataset.state="fail";}}
button.addEventListener("click",renderExample);
select.addEventListener("change",renderExample);
if(matchMedia("(max-width:420px)").matches)document.getElementById("sample-panel").open=false;
button.disabled=false;
