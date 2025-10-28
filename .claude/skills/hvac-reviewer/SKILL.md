---
name: hvac-reviewer
description: Review parser tokenization, schema validation, and offline sync logic. Use on PRs or before release.
allowed-tools: Read, Grep, Glob
---

# HVAC Reviewer

## Checklist

- Token boundaries (AAA vs AA), unit normalization (µF/uF/UF; V/volt)
- Schema: PartsLine/ServiceCall/Quote required vs optional fields
- IndexedDB + service worker + background sync flows
- Test coverage: golden + Playwright offline
