# Automatic Long-Term Memory

English | [中文](memory.zh.md)

The automatic memory capability separates a provider-neutral service (`ctx.memory`), a lifecycle consumer, and a storage provider. [`dsh-memory-context`](../../packages/memory/memory-context) recalls before the first model request of a turn and captures a successful completed turn without a tool call. [`dsh-memory-mempalace`](../../packages/memory/memory-mempalace) provides the service through direct MemPalace APIs in one managed Python process.

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

## Recall

`recall` receives the session id, direct-user query, result limit, and UTF-8 byte limit. A backend returns provider-neutral memory fragments and a truncation flag. The consumer applies its own bound, labels the injected message as untrusted background, and treats timeout, cancellation, or backend failure as an empty recall rather than a failed model turn.

## Capture

`captureTurn` receives one completed user/assistant exchange plus session, turn, completion time, and optional workspace. The consumer submits only direct user text and visible assistant text after a `completed` `turn/end`; it excludes plugin messages, reasoning, tool traffic, and subagent sessions by default. `flush` waits for accepted capture work.

## Graph exploration

`exploreGraph` is a trusted host operation over the configured provider. Its request contains an optional start room and strict node, edge, hop, and UTF-8 result-byte limits; it cannot contain graph data, paths, commands, executables, or provider configuration. The result contains renderer-neutral room/wing nodes, placement/tunnel/path edges, deterministic breadth-first visits, counts, and an explicit truncation flag. This package supplies no Dashboard endpoint or UI; a separate authenticated host consumer can forward the DTO and bind request cancellation without exposing MemPalace process or storage authority.

## Lifecycle and safety

The MemPalace provider starts one lazy worker through `ctx.subprocess`, communicates with request-id JSONL frames, and restarts after protocol failure or request timeout. Graph acquisition reuses that worker and collection, stops metadata paging at a configured scan ceiling, applies result limits in Python and TypeScript, and terminates the worker on cancellation. Its capture queue has a fixed maximum and rejects overflow explicitly. `inspectionSource()` resolves non-secret storage coordinates through that same provider configuration for read-only dashboard consumers without opening or creating storage. Child stderr, free-form provider details, environment credentials, and connection details do not enter recalled context, graph data, or dashboard status.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime-abstract-seam"></a>

### `ctx.memory` — `MemoryRuntime` (abstract seam)

Swappable long-term memory provider. Implementations own storage/process lifecycle; consumers own when recall and capture occur.

```ts cordis-catalog
/**
 * Return non-secret backend health without starting model-facing work.
 * @returns the current backend state and queue counters.
 */
abstract status(): MemoryStatus

/**
 * Resolve non-secret storage coordinates through the provider's own configuration path.
 * Providers that do not support local inspection return `undefined`.
 * @param signal - optional cancellation for provider-side resolution.
 * @returns a read-only inspection source, or `undefined` when unsupported.
 */
inspectionSource(signal?: AbortSignal): Promise<MemoryInspectionSource | undefined>

/**
 * Recall bounded background information for one turn.
 * @param request - session, query, item limit, and byte limit.
 * @param signal - optional cancellation for this recall.
 * @returns provider-neutral recalled fragments within the requested bounds.
 */
abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

/**
 * Acquire a bounded renderer-neutral graph from this configured backend.
 * The provider must read its active store directly; callers cannot supply a
 * graph, path, command, or executable.
 * @param request - strict node, edge, hop, and serialized-byte limits.
 * @param signal - optional cancellation for this acquisition.
 * @returns deterministic graph and traversal data within every requested limit.
 */
abstract exploreGraph(request: MemoryGraphRequest, signal?: AbortSignal): Promise<MemoryGraphResult>

/**
 * Enqueue one completed turn for durable capture.
 * @param turn - completed direct-user and visible-assistant exchange.
 */
abstract captureTurn(turn: MemoryCaptureTurn): Promise<void>

/** Wait until every accepted capture reaches the backend. */
abstract flush(): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
