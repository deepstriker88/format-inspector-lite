# Format Inspector Lite Cloud

Optional hosted API for the free MIT-licensed `format-inspector-lite` package

## Public sandbox preview
- URL: https://format-inspector.eztoolgo.duckdns.org
- HTTPS health verified: 200
- Paddle catalog: not connected yet, so `billingReady=false` and payment cannot be started
- robots.txt and sitemap.xml are public; IndexNow submission was accepted with HTTP 202

## Billing status
- Default environment: Paddle sandbox
- Live money: disabled until separate explicit approval
- Existing account-level Paddle default payment link is preserved during sandbox bootstrap
- Free local npm package remains fully usable without this service
- Pro: $2.99/month, 25,000 API calls/month
- Team: $6.99/month, 250,000 API calls/month

## API
- Demo: `POST /demo/inspect`
- Paid: `POST /v1/inspect`
- Usage: `GET /v1/usage`
- Activation: `POST /billing/activation`
- Claim: `POST /billing/claim`
- Paddle webhook: `POST /billing/paddle`
- Health: `GET /healthz`

## Security model
Verified Paddle webhook before entitlement, idempotent event IDs, hashed API keys after one-time claim, quota enforcement, rate limits, bounded request bodies, and automatic suspension for canceled/paused/past-due subscriptions

## Deployment budget
0.25 vCPU / 256 MiB RAM / 64 PIDs, read-only root filesystem, dropped capabilities and bounded logs

## Sandbox bootstrap
Provide a Paddle sandbox API key only for the bootstrap command; the script never persists it

```bash
PADDLE_API_KEY=... node scripts/bootstrap-paddle-sandbox.js
npm test
docker compose up -d --build
```

### Database and billing-environment boundary

A database is bound to one product and billing environment. New empty databases
are bound automatically. Existing unmarked databases are accepted only after a
verified sandbox adoption with ADOPT_LEGACY_SANDBOX_DB=1. The guard rejects
nonmatching stored key prefixes. This is not historical payment provenance:
check prior configuration and verify a backup before adopting; remove the flag
after successful migration. Live billing requires separate explicit DB_PATH
(not the sandbox default), a new database/volume, correct Paddle credentials,
and owner approval. Existing sandbox data must not be copied into a live database.
The current compose config still targets sandbox /data/commerce.sqlite; do not
enable live by changing one flag.

Use scripts/backup.js to create a consistent SQLite snapshot including committed
WAL records, with mode 0600 and no overwrite. Test restoration separately. This
does not replace encrypted off-host retention, verified operator access, or
provider reconciliation after a real-money incident. A rollback to an older
application would not enforce the new marker; restrict rollback to the same
verified sandbox environment.

Hosted requests verify raw webhook bytes. Malformed JSON does not consume the
monthly validation quota; an intentionally checked invalid value does. Request
authorization is rechecked after body parsing. Single service replica only:
local rate-limit counters are not distributed.

References:
https://developer.paddle.com/webhooks/about/signature-verification/
https://developer.paddle.com/build/go-live-checklist/
https://www.sqlite.org/lang_vacuum.html


## Optional voluntary support

Set BUY_ME_A_COFFEE_USERNAME in the deployment .env only after the owner has confirmed the actual recipient page and enabled payouts. The server renders a plain Buy me a coffee link in the legal/support area; it is absent when the setting is empty or malformed. No new external requests, tracking scripts, subscription changes, API calls or credentials. The customer leaves the site only after clicking. This is voluntary support, not a purchase or entitlement.

## Shared commerce kit
Set only the verified public login URL in PADDLE_PORTAL_SANDBOX_URL or PADDLE_PORTAL_LIVE_URL. The environment-specific link is hidden if absent or invalid. Never use temporary session URLs. /key-backup provides client-side AES-GCM encrypted backup of an existing key, portable between browsers/domains with the file and passphrase. No server upload, reissue, entitlement activation or lost-purchase authentication. See the canonical private Factory templates/commerce-kit.
