---
name: active-pane-router
description: Enforce mapping of parsed entities only into the active pane (ServiceTag, Parts, Quote). Use when users report data going to the wrong window.
allowed-tools: Read
---

# Active Pane Router

## Instructions

1. Inspect pane→fields map in `ui/paneMap.ts` (or equivalent).
2. Verify controller applies only allowed fields for the active pane.
3. Propose/patch guard code and add a Playwright assertion for it.
