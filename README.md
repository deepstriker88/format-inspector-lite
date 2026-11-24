# Format Inspector Lite

A zero-dependency, offline Node.js inspector for common text formats. No network access or data retention.

## What it does
Validates email, hostname, IPv4, IPv6, UUID, date, time, and HTTP(S) URI strings and returns machine-readable reasons.

## Quick start
Requires Node.js 18+.

```sh
npm install format-inspector-lite
```

```js
import {inspectFormat} from 'format-inspector-lite';
console.log(inspectFormat('email','user@example.com'));
```

## Common examples
```js
import {inspectBatch} from 'format-inspector-lite';
console.log(inspectBatch([{format:'date',value:'2024-02-29'}]));
```

## API
`inspectFormat(format,value)` returns `{valid,code}`.
`inspectBatch(items)` adds index and enforces a maximum of 100 items by default.
`inspectJson(text)` parses JSON arrays, limited to 1 MiB.

## Requirements
Node.js 18 or newer; no third-party dependencies.

## Optional hosted API
The MIT npm package remains fully usable offline with no account. An optional hosted layer is maintained in hosted/ for managed API keys, quotas and Paddle-backed subscription entitlement.

- Pro preview: $2.99/month — 25,000 hosted calls
- Team preview: $6.99/month — 250,000 hosted calls
- Paddle environment defaults to sandbox and live billing requires a separate explicit gate
- Product-specific Paddle sandbox catalog is not connected yet, so payment buttons remain disabled
- Hosted Docker budget: 0.25 vCPU / 256 MiB RAM / 64 PIDs

Sandbox preview: https://format-inspector.eztoolgo.duckdns.org

See [hosted/README.md](hosted/README.md) for the current implementation and verified safety model.

## Security and limitations
Local-only inspection; no requests, no persistence. URI accepts only HTTP(S) without credentials. Email checking is intentionally syntactic, not mailbox verification. Hostnames do not support IDNs unless converted to ASCII first. This is not a JSON Schema or AJV implementation. Input is bounded, but parsing can still consume CPU.

## Troubleshooting
For unsupported formats, check spelling. For malformed JSON, catch `SyntaxError`. Run `npm test` to verify installation.

## Browser preview
A static browser interface is included at `examples/index.html`; it remains local-only and makes no remote API calls. The separate hosted landing/API is publicly available at https://format-inspector.eztoolgo.duckdns.org and its desktop/mobile landing flow was browser-tested before deployment.

## Offline batch CLI and CSV / JSONL export
This package includes a local command without a persistent server or external dependencies:

```sh
format-inspector-lite --input values.json --format csv > report.csv
format-inspector-lite --csv --input values.csv --format json > report.json
cat values.jsonl | format-inspector-lite --jsonl --format jsonl > report.jsonl
```

`values.json` is an array of `{ "format": "email", "value": "person@example.com" }` records. Input is limited to 1 MiB and batches to 100 items. Exit 0 means every record passed; exit 1 means at least one record failed; exit 2 indicates malformed or oversized input. The original browser-compatible library API is unchanged.

`explainResult({valid,code})` maps machine-readable reason codes to short actionable explanations without exposing submitted values. `inspectBatch` rejects sparse and accessor-backed input entries instead of skipping them. Supported dates use the Gregorian calendar and years 0001–9999. IPv6 zone IDs and non-HTTP URI schemes are not supported. These syntax checks are not email deliverability checks or SSRF prevention.

### CSV import
Input CSV must have exactly two columns headed `format,value` (either order), with optional UTF-8 BOM and CRLF or LF line endings. Quoted commas, escaped quotes and quoted line breaks are supported. Malformed rows are returned as `INVALID_ITEM`; invalid quoting or excess record count is rejected as an input error. No file is uploaded to a remote endpoint.

## TypeScript
Type declarations are included with the package (`src/index.d.ts`), with no compiler or runtime dependency. The package remains ESM-only.

## Optional serverless HTTP adapter — NOT a deployed service
Import `createInspectorHttpHandler` from `format-inspector-lite/http` to wire the same offline checks into a caller-managed Worker or existing Node Request/Response service. This module does not open a port or start a persistent process. It requires two caller-implemented functions: `authorize(request)` must verify a **server-side** credential or entitlement, and `consumeQuota(request)` must atomically check and consume the allowed request quota. Missing handlers are rejected. Mock callbacks in tests are **not** production authentication or metering.

Only `POST` with JSON array, newline-delimited JSON, or `text/csv` is processed. Maximum body defaults to 64 KiB (configurable to 1 MiB); output is a JSON summary with the original `inspectBatch` results. Invalid format values are still HTTP 200 with `valid=false` per row; request errors are HTTP 400/413/415. Responses disable caching and browser cross-origin access is not enabled by default.

**Release blocker:** Never expose this handler publicly or accept paid traffic until real authentication, atomic quotas, abuse limits, secret handling, privacy/terms/refunds, and rollback are integrated and end-to-end tested. The package does not provide payment authorization or a rate-limit database.

## Audit real-world multi-column CSV files
`inspectTableCsv(csv, {email:'email',joined:'date'})` audits columns by header name, without extracting or uploading customer values. It returns `{rows,checks,passed,failed,valid,results}`; each result includes the 1-based data-row number, column name and error code. Missing headers, duplicate headers and unsupported mappings fail before validation. Limits: 100 data rows, 20 mapped columns and 1 MiB input.

From the CLI, save `{ "email":"email", "joined":"date" }` as `format-rules.json` and run:

```sh
format-inspector-lite --table-rules format-rules.json --input customers.csv --format csv > audit.csv
```

This processes CSV locally, uses no database or cloud API, and reports only format results—not input values. It is a syntax audit, not proof that customer records, email inboxes or websites exist.

CSV report exports protect against spreadsheet formula interpretation by prefixing risky untrusted column names with a literal apostrophe. CSV quoting alone is not considered sufficient protection for data starting with `=`, `+`, `-`, or `@`.

## Compact CSV audit summary
`import {summarizeTableCsv} from 'format-inspector-lite/report'` groups invalid cells by column and error code and includes no submitted values. Each issue includes the total failures, percentage of data rows, a short explanation and up to five example row numbers. Use `--table-rules format-rules.json --input customers.csv --summary --format json` to produce a compact machine-readable report, or `--format csv` to create a spreadsheet-compatible summary. CLI exit codes remain 0 for no failures, 1 for data validation failures and 2 for malformed input.

CLI input decoding uses strict UTF-8. Invalid byte sequences cause input errors instead of silent replacement; standard UTF-8 BOM-prefixed JSON is accepted.

## Discover possible formats without guessing one
`detectFormat('127.0.0.1')` and `detectBatch(['a@example.com','2024-02-29'])` are available from `format-inspector-lite/detect`. They return all syntactically matching formats, including ambiguous cases such as an IPv4 address that also resembles a hostname or a date-like string that resembles a hostname. Values are not echoed in results. Limit: 4,096 characters per value, up to 100 records and eight formats.

CLI: `format-inspector-lite --detect --input values.json --format csv`, where `values.json` is an array of strings. `--jsonl` accepts one JSON string per line. No network calls, identity inference, security classification or domain ownership claims are made. An ambiguous result requires user interpretation.

`explainResult(result,'ko')` provides Korean messages as an alternative to the default English messages. CSV output and compact table summaries support `--locale ko`.
