# Hosted resource budget

## Hard limits
- Container CPU: 0.25 vCPU
- Memory: 256 MiB
- PIDs: 64
- Read-only root filesystem
- /tmp: 32 MiB tmpfs
- Persistent state: one SQLite database under /data
- Logs: 10 MiB x 3 files
- No browser, AI model, OCR, media processing, crawler, vector DB or paid per-request dependency

## Core measurement
100-record core smoke completed in about 0.04s with approximately 46.5 MiB maximum RSS before the hosted gateway was added

## Hosted container measurement — 2026-11-25
- Idle CPU: approximately 0.02%
- Memory: 14.32 MiB
- PIDs: 7
- 0.25 vCPU / 256 MiB / 64 PID constraints confirmed by Docker inspect
- health and product demo request succeeded inside the constrained container

## Hosted acceptance rule
The hosted layer must pass its sandbox-flow tests and a container health/demo smoke while constrained to the limits above. If it cannot, hosted commercialization is NO_GO rather than a reason to buy a larger server
