export interface ContractIssue {column:number|null;code:'ROW_WIDTH'|'REQUIRED'|'FORMAT'|'DUPLICATE';count:number;exampleRows:number[]}
export interface ContractReport {rows:number;header:{valid:boolean;missing:number;unexpected:number;duplicateHeaders:number;orderChanged:boolean};rowChecksPerformed:boolean;invalidRows:number|null;issues:ContractIssue[];valid:boolean}
export interface ContractComparison {previous:ContractReport;current:ContractReport;comparable:boolean;delta:{rows:number;invalidRows:number|null;invalidRatePercentagePoints:number|null;issues:Array<{column:number|null;code:ContractIssue['code'];previous:number;current:number;delta:number}>|null};valid:boolean}
export function auditContract(csv:string,profile:string):ContractReport;
export function compareContract(previousCsv:string,currentCsv:string,profile:string):ContractComparison;
