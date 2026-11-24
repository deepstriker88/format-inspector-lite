# Capacity

Container benchmark completed on 2026-11-25

Measured idle/health state:
- CPU: approximately 0.02%
- Memory: 14.32 MiB / 256 MiB
- PIDs: 7
- Demo request: successful
- Health endpoint: successful
- Root filesystem: read-only
- Docker CPU quota: 0.25 vCPU confirmed

Acceptance envelope:
- <= 0.25 vCPU
- <= 256 MiB RAM
- <= 64 PIDs
- near-zero idle CPU
- bounded request body and monthly quota
- no unbounded queue or background worker

If the measured service cannot stay within this envelope, hosted release is blocked
