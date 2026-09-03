---
description: "Optional MemPalace dashboard Settings section that renders the authenticated Host projection for wings, rooms, drawers, tunnels, KG timeline facts, health signals, and retrieval transparency states."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mempalace-dashboard

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-mempalace-dashboard` contributes an optional Settings section for inspecting MemPalace from the Web client. It calls the `dsh-api-mempalace-dashboard` Host endpoint, renders the normalized structure and KG projections, and shows unavailable states for data MemPalace does not persist.

## Use this package

Enable this browser row together with the Host API row in the Web profile. The section appears in Settings as **MemPalace** and offers filters for wing, room, and drawer text. Refresh reads the current Host snapshot; the component keeps no copy of memory data after the page unloads.

## Lifecycle and security boundaries

The browser package has no filesystem access. It reads only through the authenticated Connection RPC endpoint, so Host/Origin checks and browser token exchange are owned by the existing transport. Product copy is registered through the `mempalaceDashboard` locale namespace, and the section registers through `settings.section` so settings-shell teardown removes it cleanly.

## Known Limitations and Deferred Work

- **Read-only view** — the panel intentionally edits nothing; correction, deletion, and repair workflows stay with MemPalace tools until a reviewed maintenance API exists.
- **No answer trace drilldown** — the panel renders the API's explicit retrieval-trace unavailable state because no durable per-answer trace is available to inspect.
- **No graph canvas** — the first slice is a reviewable inspection panel and typed API. A graph or timeline visualization can consume the same projection later.

## Model Experience

None. This package registers a browser Settings section only and contributes nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.
