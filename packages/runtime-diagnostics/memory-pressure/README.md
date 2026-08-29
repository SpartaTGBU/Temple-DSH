---
description: "Host memory-pressure detection: sample process heap-used against watermarks and publish level transitions on runtime/memory-pressure so shedding responders (compaction, session residency, spill, caches) react to one signal."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-pressure

English | [中文](README.zh.md)

## Summary

`dsh-memory-pressure` gives a composition one shared signal for host memory pressure. It samples the process heap-used bytes on an interval, classifies the reading against an elevated and a critical watermark, and emits `runtime/memory-pressure` on every level transition — so a steady state produces no traffic and each transition carries the reading that caused it. It owns detection only: memory-shedding responders such as compaction, the session-residency seam, spill policy, and bounded caches consume the one event and each decide how much to shed, so many independent reactions ride a single detector. Mount it when a deployment should react to host memory pressure instead of only to per-request token pressure. It registers `ctx.memoryPressure` for a direct level read and a forced sample; it never sheds anything itself.

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

Mount the plugin to publish host memory pressure, then consume the event wherever a plugin should shed under load.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-memory-pressure'
  config:
    elevatedBytes: 1073741824
    criticalBytes: 1610612736
    intervalMs: 5000
```

| Field | Default | Meaning |
|---|---|---|
| `elevatedBytes` | `1073741824` (1 GiB) | Heap-used bytes at or above which pressure is `elevated`. |
| `criticalBytes` | `1610612736` (1.5 GiB) | Heap-used bytes at or above which pressure is `critical`. Must exceed `elevatedBytes`. |
| `intervalMs` | `5000` | Sampling interval in milliseconds. |

A `criticalBytes` not above `elevatedBytes` rejects the plugin at construction, before the service registers.

### Consuming the signal

```ts
import type { MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'

declare const ctx: import('@deepseek-ai/cordis').Context

ctx.on('runtime/memory-pressure', (sample: MemoryPressureSample) => {
  if (sample.level === 'critical') {
    // shed aggressively: flush caches, evict idle sessions
  }
})
```

The event fires only on a transition. Read the current level directly with `ctx.memoryPressure.level`, or force an immediate reading with `ctx.memoryPressure.sample()` (which also publishes a transition when the level changed).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is built on one boundary: detect and announce, never shed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `MemoryPressure` service, `runtime/memory-pressure` event declaration, `classifyPressure`, watermark defaults |
| [`src/types.ts`](src/types.ts) | `MemoryPressureLevel`, `MemoryPressureSample`, `MemoryPressureConfig` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; classification is exercised by unit tests) |

### Sampling and transitions

The service arms one interval timer inside a `ctx.effect`, so the sampler is disposed with the plugin, and the timer is `unref`'d so sampling alone never keeps the process alive. Each sample reads heap-used, classifies it with `classifyPressure` (inclusive lower bounds), and emits only when the level differs from the retained current level. The reader is injectable, so tests drive deterministic readings without touching real process memory.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory meter](../../util/memory-meter/README.md) — the per-session accounting a responder pairs with this signal to pick eviction candidates.
- [Session subsystem](../../../docs/subsystems/session.md) — the in-memory store a residency responder sheds from.

-----

<a id="model-experience"></a>
## Model Experience

None, as this host memory-pressure detector samples process memory and registers no prompt, message, tool, or schema.

#### KV Cache effect

No direct invalidation; it observes host memory and never mutates a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the plugin deliberately does not do. They are current package constraints, not a task backlog.

- **Detection only** — it publishes a level and never sheds; a deployment gets no relief unless a responder consumes the event.
- **Heap-used, not RSS** — it classifies `heapUsedBytes`, which tracks the JS object graph but not native or external buffers; a workload dominated by off-heap memory needs a different reader.
- **Interval sampling** — a spike between samples is seen only at the next tick; the interval trades detection latency against sampling cost.
- **Global watermarks** — one elevated/critical pair applies process-wide; it does not attribute pressure to a session or partition a budget per workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
