---
description: "Zero-dependency retained-byte accounting for in-memory sessions: estimate a session's approximate heap cost from its public event log and rank sessions for eviction, telemetry, and memory benchmarks."
kind: "package-library"
---

# @deepseek-ai/dsh-memory-meter

English | [中文](README.zh.md)

## Summary

`dsh-memory-meter` lets any plugin measure how much heap a session is holding without reaching into private session internals. It estimates the approximate retained bytes of a session from its public event log — serialized content bytes plus a fixed per-event object overhead — and ranks sessions by cost so an eviction policy or a telemetry surface can act on the costliest first. The estimate is a stable, cheap heuristic that is monotonic in log size, which is what a memory-pressure responder needs; it is not an exact heap measurement. The library is dependency-free and reads only the `events` array a session already exposes, so it stays decoupled from the session package's implementation. Pair it with the shipped host benchmark to get real before/after RSS numbers when you change what a session retains.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use `estimateSessionMemory` to cost one session, and `reportSessionMemory` to rank every session a store lists. Both read only the public `events` surface, so they never depend on private session fields.

### Costing one session

```ts
import { estimateSessionMemory } from '@deepseek-ai/dsh-memory-meter'

declare const session: { readonly events: readonly unknown[] }

const estimate = estimateSessionMemory(session)
// estimate.retainedBytes = contentBytes + count * EVENT_OBJECT_OVERHEAD_BYTES
```

`contentBytes` is the summed UTF-8 length of each event's JSON serialization; `overheadBytes` charges a fixed per-event object cost. An event that cannot be serialized (a cycle) contributes zero content bytes but still counts its overhead, so the estimate never throws on a live log.

### Ranking a store's sessions

```ts
import { reportSessionMemory } from '@deepseek-ai/dsh-memory-meter'

declare const store: { list(): readonly { readonly id: unknown; readonly events: readonly unknown[] }[] }

const report = reportSessionMemory(store)
// report.sessions is sorted by descending retainedBytes — the eviction candidates first
// report.totalRetainedBytes is the aggregate across every listed session
```

`reportSessionMemory` accepts anything with a `list()` returning event-bearing units, so the dsh `SessionStore` (`ctx.sessions`) fits directly. The costliest session is `report.sessions[0]`.

### Measuring reclaimable chunk bytes

```ts
import { estimateChunkReclaim, reportChunkReclaim } from '@deepseek-ai/dsh-memory-meter/chunk-reclaim'

declare const session: { readonly events: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }

const est = estimateChunkReclaim(session.events)
// est.reclaimableBytes = residentBytes - packedBytes, the heap a chunk-run pack would free
```

Streamed `assistant/chunk` runs dominate a completed session's resident bytes. `estimateChunkReclaim` reports how much a session would reclaim by packing those runs with the shipped chunk-row codec — a pure, non-mutating measurement over a read-only copy. `reportChunkReclaim(store)` ranks every listed session by descending reclaimable chunk bytes. This entry needs `@deepseek-ai/dsh-session`; the base module stays dependency-free.

### Measuring cold log for tiering

```ts
import { estimateLogTiering, reportLogTiering } from '@deepseek-ai/dsh-memory-meter/log-tiering'

declare const session: { readonly events: readonly unknown[]; readonly surface: { readonly nodes: readonly number[] } }

const est = estimateLogTiering(session)
// est.coldBytes is the resident prefix below the derivation surface — pageable to persistence
```

`deriveMessages()` only walks the surface nodes, so every event below the lowest surface node is cold and never re-derived unless a fork or export faults it back. `estimateLogTiering` splits a session's resident log into that cold prefix (reclaimable) and the hot tail (must stay resident), reading only the public events and surface. `reportLogTiering(store)` ranks sessions by descending cold bytes. This entry is zero-dependency like the base module.

### Running the host memory benchmark

```text
node --expose-gc --import tsx/esm packages/util/memory-meter/tests/host-memory.perf.ts
```

The benchmark builds `BENCH_SESSIONS` (default 200) sessions of `BENCH_EVENTS` (default 400) events each and prints the real RSS/heap delta beside the meter's estimate, so a change to session retention has a concrete before/after number. See [MEMORY-BENCHMARK.md](MEMORY-BENCHMARK.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The library is built on one boundary: estimate from the public log, never from private session state.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `estimateEvents`, `estimateSessionMemory`, `reportSessionMemory`, `contentBytesOf`, `utf8ByteLength`, `EVENT_OBJECT_OVERHEAD_BYTES` |
| [`src/chunk-reclaim.ts`](src/chunk-reclaim.ts) | `estimateChunkReclaim`, `reportChunkReclaim`, `countChunkEvents` (optional `./chunk-reclaim` entry; needs `dsh-session`) |

| [`src/log-tiering.ts`](src/log-tiering.ts) | `estimateLogTiering`, `reportLogTiering`, `coldBoundaryOf` (optional `./log-tiering` entry; zero-dependency) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; the accounting algebra is exercised by unit tests) |
| [`tests/host-memory.perf.ts`](tests/host-memory.perf.ts) | Runnable host benchmark comparing estimate to real RSS/heap |

### Why a heuristic, not exact heap walking

An exact per-object retained-size walk is expensive and unstable across V8 versions. The serialized-bytes-plus-overhead heuristic is O(log size), deterministic, and monotonic — a session that grows always costs more — which is the only property an eviction ranking actually requires. The host benchmark records the real heap-to-estimate ratio so a deployment can calibrate a byte budget against its own workload.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when you need the design context behind the accounting.

- [Session subsystem](../../../docs/subsystems/session.md) — the in-memory store and event log this library measures.

-----

<a id="model-experience"></a>
## Model Experience

None, as this host memory-accounting library measures session state and registers no prompt, message, tool, or schema.

#### KV Cache effect

No direct invalidation; it reads session state and never mutates a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the library deliberately does not do. They are current package constraints, not a task backlog.

- **Estimate, not measurement** — the retained-byte number is a serialized-content heuristic plus fixed overhead, not an exact V8 retained size; calibrate against the host benchmark's heap ratio for a real budget.
- **Reads the public log only** — it cannot see derived caches, snapshots, or provider buffers a session also holds; it costs the event log, which dominates but is not the whole footprint.
- **Serialization cost on demand** — `contentBytesOf` serializes each event, so a report over very many large sessions is not free; callers sample or cache when ranking on a hot path.
- **No eviction or pressure logic** — this package only measures and ranks; deciding when to shed and what to do lives in the memory-pressure and residency seams (Gaps B and A).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
