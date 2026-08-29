# 会话驻留

[English](session-residency.md) | 中文

[dsh-session-residency](../../packages/session/session-residency) 是会话驱逐决策策略（`ctx.sessionResidency`）。在宿主内存压力下，它用每会话内存计量器对某个存储列出的常驻会话排序，并选择空闲、已闭合回合的驱逐候选者，绝不选择带有打开回合的会话或在空闲窗口内活动过的会话。它只负责决策：机械的丢弃与再水合被委托给所注册的 `ResidencyExecutor`，因此该策略保持为存储公开表面的纯粹、可替换函数，而会话存储主干不受触动。

Source: [`packages/session/session-residency/src/index.ts`](../../packages/session/session-residency/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionresidency--sessionresidency"></a>

### `ctx.sessionResidency` — `SessionResidency`

Session residency decision service (`ctx.sessionResidency`).

```ts cordis-catalog
/**
 * Register the mechanism that actually drops and rehydrates a session.
 * @param executor - the residency executor.
 * @returns a disposer that unregisters the executor.
 */
registerExecutor(executor: ResidencyExecutor): () => void

/**
 * Whether the given pressure level is at or above the configured floor.
 * @param level - the current pressure level.
 * @returns true when eviction should run.
 */
shouldRun(level: MemoryPressureLevel): boolean

/**
 * Plan which sessions to evict now, ranked by descending retained bytes and
 * filtered to idle, closed-turn sessions. Reads the store's public surface
 * and the memory meter; performs no eviction itself.
 * @param store - the session store (its public list()).
 * @param lastActiveAt - last-active timestamp accessor (ms epoch) per id.
 * @param now - current time in ms epoch (injectable for tests).
 * @returns the ordered eviction plan, capped at maxEvictionsPerPass.
 */
plan(store: SessionListing, lastActiveAt: LastActiveAt, now: number = Date.now()): EvictionPlan

/**
 * Run one eviction pass: plan candidates and, when an executor is registered,
 * evict each. Returns the plan acted on. A no-executor composition returns
 * the plan without evicting, so reporting works without opting in.
 * @param store - the session store.
 * @param lastActiveAt - last-active timestamp accessor per id.
 * @param now - current time in ms epoch (injectable for tests).
 * @returns the eviction plan that was executed (or only planned).
 */
async runPass(store: SessionListing, lastActiveAt: LastActiveAt, now: number = Date.now()): Promise<EvictionPlan>

/**
 * React to a memory-pressure transition: run a pass when the level meets the
 * floor. The store and last-active source are supplied by the composition
 * that wires this policy to its session store.
 * @param sample - the memory-pressure sample.
 * @param store - the session store.
 * @param lastActiveAt - last-active timestamp accessor per id.
 * @returns the plan acted on, or undefined when the level was below the floor.
 */
async onPressure(sample: MemoryPressureSample, store: SessionListing, lastActiveAt: LastActiveAt): Promise<EvictionPlan | undefined>
```

Source: [`packages/session/session-residency/src/index.ts`](../../packages/session/session-residency/src/index.ts)
<!-- END GENERATED cordis-surface -->
