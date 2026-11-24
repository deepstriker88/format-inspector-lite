# Format Inspector Lite Cloud

Optional hosted API for the free MIT-licensed `format-inspector-lite` package

## Billing status
- Default environment: Paddle sandbox
- Live money: disabled until separate explicit approval
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
