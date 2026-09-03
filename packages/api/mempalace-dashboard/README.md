---
description: "Read-only MemPalace dashboard projection and authenticated Web API for local inspection of wings, rooms, drawers, tunnels, KG facts, health signals, and retrieval transparency availability."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mempalace-dashboard

English | [中文](README.zh.md)

## Summary

`dsh-api-mempalace-dashboard` is an opt-in Host API for inspecting the MemPalace selected by `ctx.memory`. The provider resolves its own palace, collection, backend, and capture wing; a one-shot worker reads drawer SQLite metadata, `tunnels.json`, and `knowledge_graph.sqlite3` through read-only handles and returns one normalized snapshot for the web client. Missing providers, degraded configuration resolution, retrieval traces, maintenance health scans, or unsupported storage backends are explicit unavailable states.

## Table of Contents

- [Use this package](#use-this-package)
- [Lifecycle and security boundaries](#lifecycle-and-security-boundaries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in the Web host plane and enable the matching client package. The shipped Web profile enables the native provider, automatic consumer, Host API, and browser row together only when `MEMPALACE_ENABLED=1`; unset and all other values leave all four rows disabled.

The API registers one authenticated shared-channel endpoint, `mempalaceDashboard/inspect`, below `/api`. It accepts optional `wing`, `room`, `query`, and `limit` fields. Empty strings are ignored, `limit` is clamped to 1..100, aggregate rows are capped, and sidecar bytes are bounded. `sourceTimeoutMs` bounds provider resolution and `projectionTimeoutMs` bounds each one-shot inspection worker.

-----

<a id="lifecycle-and-security-boundaries"></a>
## Lifecycle and security boundaries

The plugin performs no writes and opens SQLite databases with `readOnly` plus `PRAGMA query_only`. Provider configuration resolution uses the native provider's private managed bridge but does not open or create a collection. Blocking SQLite and sidecar reads run in a worker thread; endpoint disposal terminates in-flight workers. The endpoint is available only after the composed Connection service applies its normal Host/Origin checks and browser authentication.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers a Host inspection API only and contributes nothing to prompts, tools, or model-visible context.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Backends** — the projection reads the local `chroma` and `sqlite_exact` SQLite layouts. Qdrant, Milvus, pgvector, and live Hub-only state report `unsupported-backend` rather than fabricating a partial palace.
- **Retrieval transparency** — upstream MemPalace search returns candidates and scores, but the inspected files do not persist which drawers, KG facts, filtered candidates, or model-context text influenced a specific DSH answer. The API returns `retrieval-traces-not-persisted` until a durable trace source exists.
- **Health** — drawer, wing, room, and KG counts are proven from files. Duplicate, stale-memory, contradiction, and orphan scans are maintenance operations with no persisted result file, so they return `memory-health-not-persisted`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
