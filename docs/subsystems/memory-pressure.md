# Memory Pressure

English | [中文](memory-pressure.zh.md)

[dsh-memory-pressure](../../packages/runtime-diagnostics/memory-pressure) is the host memory-pressure detector (`ctx.memoryPressure`). It samples the process heap-used bytes on an interval, classifies each reading against an elevated and a critical watermark, and emits `runtime/memory-pressure` on every level transition. It owns detection only: memory-shedding responders such as compaction, the session-residency seam, spill policy, and bounded caches consume the one event and each decide how much to shed, so many independent reactions ride a single detector.

Source: [`packages/runtime-diagnostics/memory-pressure/src/index.ts`](../../packages/runtime-diagnostics/memory-pressure/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemorypressure--memorypressure"></a>

### `ctx.memoryPressure` — `MemoryPressure`

Host memory-pressure detection service (`ctx.memoryPressure`).

```ts cordis-catalog
/**
 * Take one reading now, publish a transition when the level changed, and
 * return the sample. Exposed so a caller (or a test) can force a sample
 * outside the interval.
 * @returns the sample taken.
 */
sample(): MemoryPressureSample
```

Source: [`packages/runtime-diagnostics/memory-pressure/src/index.ts`](../../packages/runtime-diagnostics/memory-pressure/src/index.ts)

<a id="runtime-events"></a>

### `runtime/*` events

<a id="runtimememory-pressure--emit"></a>

#### `runtime/memory-pressure` — emit

The host memory-pressure level changed. Emitted only on a transition, so a steady state produces no traffic. Responders read the new level and shed proportionally; the sample carries the reading that triggered it. Dispatched synchronously to observers; a throwing listener is contained and never reaches the sampler timer.

```ts cordis-catalog
/**
 * The host memory-pressure level changed. Emitted only on a transition, so
 * a steady state produces no traffic. Responders read the new level and
 * shed proportionally; the sample carries the reading that triggered it.
 * Dispatched synchronously to observers; a throwing listener is contained
 * and never reaches the sampler timer.
 * @param sample - the level and the memory reading that produced it.
 * @mode emit
 */
'runtime/memory-pressure'(sample: MemoryPressureSample): void
```

Source: [`packages/runtime-diagnostics/memory-pressure/src/index.ts`](../../packages/runtime-diagnostics/memory-pressure/src/index.ts)
<!-- END GENERATED cordis-surface -->
