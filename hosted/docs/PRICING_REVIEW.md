# Pricing review — 2026-11-25

## Decision
- Free local core: $0, MIT, no account required
- Pro sandbox list price: $2.99/month for 25,000 hosted API calls
- Team sandbox list price: $6.99/month for 250,000 hosted API calls
- Live billing: disabled pending separate approval and demand evidence
- Annual plan: not offered initially to avoid premature discounting and billing complexity

## Current external reference points
- Paddle standard Checkout fee: 5% + $0.50 per transaction
- CSVBox Startup starts at $16/month billed yearly; Apify CSV Quality Validator lists $4 per 1,000 validated tables

## Unit economics before tax/FX/refunds/support
- Pro approximate net after Paddle standard fee: $2.34 per monthly checkout
- Team approximate net after Paddle standard fee: $6.14 per monthly checkout
- Oracle hosting cash cost is currently $0 inside the free allocation, but this is not treated as permanent zero economic cost
- Core 100-record smoke: about 0.04s and 46.5 MiB max RSS, so quotas are intentionally conservative for the shared host

## Pricing rule
Do not claim cheapest. Do not increase quotas merely to compete. Re-evaluate after sustained installs, real hosted usage, support burden, conversion and server headroom are known

## Sources checked
- https://www.paddle.com/pricing
- https://csvbox.io/pricing/
- https://apify.com/tidytools/csv-quality-validator
- https://bubble.io/plugin/json-schema-validator-1791748709871x124059663234760700
