// Privacy-minimized summary for multi-column CSV syntax audits.
import {inspectTableCsv,explainResult} from './index.js';
export function summarizeTableResults(report,{locale='en'}={}){
 if(!['en','ko'].includes(locale))throw new RangeError('unsupported locale');
 if(!report||!Array.isArray(report.results)||!Number.isSafeInteger(report.rows)||report.rows<0)throw new TypeError('invalid table report');
 const groups=new Map(),columns=new Map();
 for(const item of report.results){
  if(!item||!Number.isSafeInteger(item.row)||item.row<1||!Number.isInteger(report.rows)||item.row>report.rows)throw new TypeError('invalid table result');
  const column=item.column===null?'(row)':item.column;
  if(typeof column!=='string')throw new TypeError('invalid result column');
  let columnStats=columns.get(column);
  if(!columnStats){columnStats={column,checks:0,failures:0};columns.set(column,columnStats);}
  columnStats.checks++;
  if(item.valid)continue;
  columnStats.failures++;
  const key=column+'\u0000'+item.code;
  let issue=groups.get(key);
  if(!issue){
   issue={column,code:item.code,failures:0,exampleRows:[],message:explainResult(item,locale)};
   groups.set(key,issue);
  }
  issue.failures++;
  if(issue.exampleRows.length<5)issue.exampleRows.push(item.row);
 }
 const issues=[...groups.values()].sort((a,b)=>b.failures-a.failures||a.column.localeCompare(b.column,'en')||a.code.localeCompare(b.code,'en'));
 const columnsSummary=[...columns.values()].sort((a,b)=>a.column.localeCompare(b.column,'en'));
 for(const entry of columnsSummary){
  entry.failureRatePercent=entry.checks?Math.round(entry.failures/entry.checks*10000)/100:0;
 }
 for(const issue of issues){
  issue.percentOfRows=report.rows?Math.round(issue.failures/report.rows*10000)/100:0;
 }
 return {rows:report.rows,checks:report.checks,passed:report.passed,failed:report.failed,columns:columnsSummary,issues};
}
export function summarizeTableCsv(text,formats,options){return summarizeTableResults(inspectTableCsv(text,formats),options);}
