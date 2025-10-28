---
name: pwa-offline-checks
description: Verify offline-first behavior and voice→field flows using Playwright. Use before merges to ensure Parts, Service Tag, and Quote panes still work offline/online.
allowed-tools: Run, Read
---

# PWA Offline Checks

## Instructions

1. Run `npm run test:e2e`.
2. If failures mention selectors or timing, fix tests or app minimally.
3. Re-run and report pass/fail plus where screenshots are stored.
