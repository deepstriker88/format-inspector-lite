import type {FormatName} from './index.js';
export declare const SUPPORTED_FORMATS: ReadonlyArray<FormatName>;
export interface DetectedFormat {
  matched: boolean;
  ambiguous: boolean;
  matches: FormatName[];
  code: 'OK' | 'NO_MATCH' | 'NOT_STRING' | 'VALUE_TOO_LONG' | 'ACCESSOR_PROPERTY' | 'INSPECTION_FAILED';
}
export interface BatchDetection {
  count: number;
  matched: number;
  unmatched: number;
  results: Array<DetectedFormat & {index:number}>;
}
export declare function detectFormat(value: unknown, options?: {candidates?: readonly FormatName[]}): DetectedFormat;
export declare function detectBatch(values: readonly unknown[], options?: {candidates?: readonly FormatName[];maxItems?: number}): BatchDetection;
