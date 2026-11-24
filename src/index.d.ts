/** Supported offline syntax checks. */
export type FormatName = 'email' | 'hostname' | 'ipv4' | 'ipv6' | 'uuid' | 'date' | 'time' | 'uri';
export type FormatErrorCode = 'OK' | 'UNSUPPORTED_FORMAT' | 'NOT_STRING' | 'VALUE_TOO_LONG' | 'INVALID_FORMAT' | 'INVALID_ITEM' | 'INVALID_ROW' | 'ACCESSOR_PROPERTY' | 'INSPECTION_FAILED';
export interface InspectionResult { valid: boolean; code: FormatErrorCode }
export interface IndexedInspectionResult extends InspectionResult { index: number }
export interface BatchOptions { maxItems?: number }
export declare function inspectFormat(format: FormatName | (string & {}), value: unknown): InspectionResult;
export declare function inspectBatch(input: readonly unknown[], options?: BatchOptions): IndexedInspectionResult[];
export declare function inspectJson(text: string): IndexedInspectionResult[];
export declare function inspectCsv(text: string): IndexedInspectionResult[];
export declare function explainResult(result: {code?: string} | null | undefined, locale?: 'en' | 'ko'): string;

export interface TableInspectionResult { row: number; column: string | null; valid: boolean; code: FormatErrorCode }
export interface TableReport { rows: number; checks: number; passed: number; failed: number; valid: boolean; results: TableInspectionResult[] }
export declare function inspectTableCsv(text: string, formats: Readonly<Record<string, FormatName>>): TableReport;
