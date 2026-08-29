---
description: "Cache-release residency executor: when the residency policy selects a session under memory pressure, drop its volatile derived caches (events snapshot, derived messages, request-context fold) while the durable log stays resident and rebuilds lazily."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-residency-cache-release

English | [中文](README.zh.md)

## Summary

`dsh-session-residency-cache-release` is the mechanical half of session eviction: it reclaims a session's volatile heap when the residency policy selects it under memory pressure. Registered as the policy's `ResidencyExecutor`, it calls `Session.releaseCaches()` on each selected session, dropping the events snapshot, the derived-message projection, and the request-context fold. The durable event log is never touched, and every dropped cache rebuilds lazily from that log on its next accessor, so a released session is observationally identical — same derived messages, same events, same context. Mount it alongside `dsh-session-residency` (and the memory meter and memory-pressure detector) to turn the residency decision into a real, safe memory reclaim. It performs no eviction on its own; it only acts when the policy hands it a candidate.

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

Mount the plugin in a composition that already has `ctx.sessions` and `ctx.sessionResidency`. It registers itself as the residency executor at apply time; no configuration.

```yaml
- name: '@deepseek-ai/dsh-memory-meter'
- name: '@deepseek-ai/dsh-memory-pressure'
- name: '@deepseek-ai/dsh-session-residency'
- name: '@deepseek-ai/dsh-session-residency-cache-release'
```

Once mounted, a residency pass that selects a session resolves it through `ctx.sessions.get` and calls `releaseCaches()`. A candidate whose session already left the store is a no-op. The session stays live and its next read rebuilds the dropped caches from the durable log.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is built on one guarantee: release only what rebuilds from the log.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Registers the `ResidencyExecutor` that resolves a candidate and calls `Session.releaseCaches()` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; observational identity is exercised by the session package's derived-cache tests) |

### Why cache release is safe

A session's dominant volatile cost is three lazily-built caches — the frozen events snapshot, the derived-message array, and the request-context fold — each a pure function of the append-only log. `Session.releaseCaches()` drops all three and resets their bookkeeping so the next `events`, `deriveMessages()`, or `requestContext()` rebuilds identically. Because the durable log, the surface, and the store lifecycle are untouched, releasing a live session cannot change any observable value; it only returns heap the caches were holding. The registration rides `ctx.effect`, so the executor unregisters cleanly when the plugin unloads.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session residency](../session-residency/README.md) — the decision policy that selects candidates and drives this executor.
- [Memory meter](../../util/memory-meter/README.md) — the accounting that ranks sessions for eviction.
- [Memory pressure](../../runtime-diagnostics/memory-pressure/README.md) — the signal that triggers a pass.
- [Session subsystem](../../../docs/subsystems/session.md) — the log and caches this executor releases.

-----

<a id="model-experience"></a>
## Model Experience

None, as this executor releases host-side caches and registers no prompt, message, tool, or schema.

#### KV Cache effect

No direct invalidation; a released session re-derives an identical log, so a reused request prefix is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the executor deliberately does not do. They are current package constraints, not a task backlog.

- **Cache release, not a full drop** — it reclaims the volatile caches while the durable log stays resident; a session's whole footprint leaves the heap only when a future store-level eviction hook drops the log itself.
- **Rebuild cost on next read** — the first accessor after a release re-walks the log to rebuild the derived caches, trading a one-time recompute for the reclaimed heap.
- **One executor per policy** — the residency policy accepts a single executor; mounting a second executor plugin is rejected at registration.
- **Acts only on selection** — it reclaims nothing on its own; without the residency policy handing it candidates under pressure, it never runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The full resident-log drop (and rehydration from persistence) is the natural successor, once the session store exposes a spine-level eviction hook that removes a log while keeping the entry rehydratable. This executor is the safe, reversible first step that reclaims the derived-cache memory today.

</details>
