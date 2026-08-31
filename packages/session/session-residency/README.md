---
description: "Session residency policy: under host memory pressure, rank resident sessions with the memory meter and select idle, closed-turn eviction candidates for a swappable residency executor, so cold sessions can leave the heap without losing modularity."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-residency

English | [中文](README.zh.md)

## Summary

`dsh-session-residency` decides which idle sessions should leave the heap when the host is under memory pressure. It consumes the `runtime/memory-pressure` signal and the per-session memory meter to rank the sessions a store lists, then selects eviction candidates while never choosing a session with an open turn or one active within the idle window. It owns the decision only: the mechanical drop-and-rehydrate is delegated to a `ResidencyExecutor` a deployment registers, so the policy stays pure and swappable and the session-store spine is untouched. With no executor registered it reports candidates without evicting, so a composition can measure the policy before opting in. Mount it (with `dsh-memory-meter` and `dsh-memory-pressure`) when a long-running host should shed cold sessions instead of holding every session resident for its whole lifetime.

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

Mount the plugin, register the executor that actually evicts, and wire the memory-pressure event to a pass over your session store.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-session-residency'
  config:
    idleMs: 300000
    minLevel: elevated
    maxEvictionsPerPass: 8
```

| Field | Default | Meaning |
|---|---|---|
| `idleMs` | `300000` (5 min) | Milliseconds a session must be idle before it may be evicted. |
| `minLevel` | `elevated` | Pressure level at or above which an eviction pass runs. |
| `maxEvictionsPerPass` | `8` | Maximum sessions evicted in one pass. |

### Registering the executor and reacting to pressure

```ts
import type {} from '@deepseek-ai/dsh-session-residency'
import type { EvictionCandidate } from '@deepseek-ai/dsh-session-residency'
import type { MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListing } from '@deepseek-ai/dsh-memory-meter'

declare const ctx: Context
declare const store: SessionListing
declare const lastActiveAt: (id: unknown) => number | undefined

ctx.sessionResidency.registerExecutor({
  async evict(candidate: EvictionCandidate) {
    // persist and drop the session's resident state so it rehydrates on next access
  },
})

ctx.on('runtime/memory-pressure', (sample: MemoryPressureSample) => {
  void ctx.sessionResidency.onPressure(sample, store, lastActiveAt)
})
```

`onPressure` runs a pass only when the level meets the floor. `plan(store, lastActiveAt)` returns the ranked candidates without acting, and `runPass(...)` plans and evicts through the registered executor. Because `deriveMessages()` is a pure re-derivation from the durable log, a session dropped by the executor and rehydrated from persistence is byte-identical.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is built on one boundary: decide from the public surface, delegate the drop.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SessionResidency` service, `hasOpenTurn`, `shouldRun`, `plan`, `runPass`, `onPressure`, defaults |
| [`src/types.ts`](src/types.ts) | `EvictionCandidate`, `EvictionPlan`, `ResidencyExecutor`, `ResidencyConfig` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; planning is exercised by unit tests) |

### Why the policy never evicts directly

The store keys a session's lifetime to its owning Cordis fiber; safely dropping resident state is a spine concern. Keeping eviction behind a registered `ResidencyExecutor` means the policy is a pure function of the store's public `list()`, the memory meter, and a last-active accessor — testable without a real store and swappable per deployment. `hasOpenTurn` reads the public event log (last turn boundary) so an active turn is never a candidate, satisfying the cooperative-eviction requirement without private session access.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory meter](../../util/memory-meter/README.md) — the per-session accounting this policy ranks with.
- [Memory pressure](../../runtime-diagnostics/memory-pressure/README.md) — the signal that triggers an eviction pass.
- [Session persistence](../session-persistence/README.md) — the seam an executor uses to persist and rehydrate a dropped session.

-----

<a id="model-experience"></a>
## Model Experience

None, as this host residency policy decides session eviction and registers no prompt, message, tool, or schema.

#### KV Cache effect

No direct invalidation; a rehydrated session re-derives an identical log, so a reused request prefix is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the package deliberately does not do. They are current package constraints, not a task backlog.

- **Decision only** — it selects candidates and calls an executor; with no executor a composition gets ranking but no relief. The mechanical store drop-and-rehydrate is the executor's job.
- **Last-active is supplied** — the policy does not track activity itself; the composition passes a `lastActiveAt` accessor, so idle accuracy is only as good as that source.
- **Serialized-byte ranking** — eviction order uses the memory meter's estimate, not exact retained size; a workload with unusual object shapes may rank imperfectly.
- **One pass per trigger** — a pass caps evictions at `maxEvictionsPerPass`; sustained pressure relies on repeated transitions rather than a single sweep of every idle session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The shipped executor that performs the actual resident-state drop and persistence rehydration is intended as a follow-up package once the store exposes a spine-level eviction hook; this policy is the decision half that unblocks it.

</details>
