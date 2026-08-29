# 内存压力

[English](memory-pressure.md) | 中文

[dsh-memory-pressure](../../packages/runtime-diagnostics/memory-pressure) 是宿主内存压力检测器（`ctx.memoryPressure`）。它按间隔采样进程 heap-used 字节，将每个读数按 elevated 与 critical 两个水位分类，并在每次级别跃迁时发出 `runtime/memory-pressure`。它只负责检测：诸如压实、会话驻留接缝、溢出策略与有界缓存等内存卸载响应者消费这唯一事件，并各自决定卸载多少，因此众多独立反应共乘一个检测器。

Source: [`packages/runtime-diagnostics/memory-pressure/src/index.ts`](../../packages/runtime-diagnostics/memory-pressure/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
