# Session Residency

English | [中文](session-residency.zh.md)

[dsh-session-residency](../../packages/session/session-residency) is the session-eviction decision policy (`ctx.sessionResidency`). Under host memory pressure it ranks the resident sessions a store lists with the per-session memory meter and selects idle, closed-turn eviction candidates, never choosing a session with an open turn or one active within the idle window. It owns the decision only: the mechanical drop-and-rehydrate is delegated to a registered `ResidencyExecutor`, so the policy stays a pure, swappable function of the store's public surface and the session-store spine is untouched.

Source: [`packages/session/session-residency/src/index.ts`](../../packages/session/session-residency/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
