import type {FormatName,FormatErrorCode,TableReport} from './index.js';
export interface TableIssueSummary {
  column: string;
  code: FormatErrorCode;
  failures: number;
  exampleRows: number[];
  message: string;
  percentOfRows: number;
}
export interface ColumnSummary {
  column: string;
  checks: number;
  failures: number;
  failureRatePercent: number;
}
export interface CsvAuditSummary {
  rows: number;
  checks: number;
  passed: number;
  failed: number;
  columns: ColumnSummary[];
  issues: TableIssueSummary[];
}
export declare function summarizeTableResults(report: TableReport, options?: {locale?:'en'|'ko'}): CsvAuditSummary;
export declare function summarizeTableCsv(text: string, formats: Readonly<Record<string,FormatName>>, options?: {locale?:'en'|'ko'}): CsvAuditSummary;
