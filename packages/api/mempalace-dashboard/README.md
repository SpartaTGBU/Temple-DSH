---
description: "Read-only MemPalace dashboard projection and authenticated Web API for local inspection of wings, rooms, drawers, tunnels, KG facts, health signals, and retrieval transparency availability."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mempalace-dashboard

English | [中文](README.zh.md)

## Summary

`dsh-api-mempalace-dashboard` is an opt-in Host API for inspecting a local MemPalace without importing or modifying MemPalace itself. It reads MemPalace config, drawer SQLite metadata, `tunnels.json`, and `knowledge_graph.sqlite3` through read-only handles and returns one normalized snapshot for the web client. Missing retrieval traces, maintenance health scans, or unsupported backends are returned as explicit unavailable states.

## Use this package

Mount the package in the Web host plane and enable the matching client package. The Web bundle ships both rows disabled; a profile or patch layer opts in by enabling `mempalace-dashboard` and `ui-mempalace-dashboard`.

The API registers one authenticated shared-channel endpoint, `mempalaceDashboard/inspect`, below `/api`. It accepts optional `wing`, `room`, `query`, and `limit` fields. Empty strings are ignored, and `limit` is clamped to 1..100. `palacePath` and `configPath` may be configured in the row; otherwise the adapter follows MemPalace's local config and environment conventions.

## Lifecycle and security boundaries

The plugin performs no writes and opens SQLite databases with `readOnly` plus `PRAGMA query_only`. It never shells out to the MemPalace CLI and never imports the checked-out MemPalace source tree. The endpoint is available only after the composed Connection service applies its normal Host/Origin checks and browser authentication. Because memory contents are sensitive, the Web bundle leaves the row disabled until a deployment opts in.

## Known Limitations and Deferred Work

- **Backends** — the projection reads the local `chroma` and `sqlite_exact` SQLite layouts. Qdrant, Milvus, pgvector, and live Hub-only state report `unsupported-backend` rather than fabricating a partial palace.
- **Retrieval transparency** — upstream MemPalace search returns candidates and scores, but the inspected files do not persist which drawers, KG facts, filtered candidates, or model-context text influenced a specific DSH answer. The API returns `retrieval-traces-not-persisted` until a durable trace source exists.
- **Health** — drawer, wing, room, and KG counts are proven from files. Duplicate, stale-memory, contradiction, and orphan scans are maintenance operations with no persisted result file, so they return `memory-health-not-persisted`.

## Model Experience

None. This package registers a Host inspection API only and contributes nothing to prompts, tools, or model-visible context.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.
