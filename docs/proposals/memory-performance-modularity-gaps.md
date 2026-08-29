# Memory Performance vs. Modularity: Gap Analysis

Status: proposal / working draft (non-authoritative planning document for Temple-DSH).
Owner: Temple-DSH maintainers. Supersede or delete once the work it describes lands.

## Purpose

Temple-DSH defining strength is its everything-is-a-plugin Cordis architecture: sessions, tools, the model adapter, and the agent loop are all replaceable plugins that contribute services, typed events, and reversible effects to a shared context. We want the harness to be significantly more memory-performant without weakening that modularity: no privileged core, no monolithic fast-path that plugins cannot patch.

This document audits how memory is held today, names the gaps, and proposes optimizations that preserve (or extend) the seam model.

## How the system holds memory today (audit)

### 1. The in-memory session store is fully resident
SessionStore (ctx.sessions, packages/core/session/src/index.ts) keeps every live session in a Map of SessionId to SessionEntry. A session stays fully resident (its entire append-only SessionEvent log, plus derived caches) for as long as its owning Cordis fiber is alive. There is no idle-session eviction, no memory-pressure response, and no partial hydration. The store own doc comment states persistence is intentionally not implemented here.

Per session, the resident structures are:
- this.log: the complete append-only event array (grows unbounded within a turn history).
- eventsSnapshot: a frozen copy, lazily built for events() consumers and invalidated on append.
- derived: the derived-message projection cache (deriveMessages()), extended incrementally per surface node, rebuilt on a compaction replace.
- contextFold: token-meter accounting fold.
- Raw assistant/chunk rows: retained in the log for replay and UI fidelity.

### 2. Persistence is write-only at runtime, but can rehydrate
ctx.sessionPersistence (session-persistence, backends jsonl and sqlite) is append-on-session/event, flush-on-session/flush. Crucially, the seam already reloads a session log on resume (Session.fromRestore). The machinery to reconstruct a session from durable storage exists; it is simply never triggered by memory pressure, only by an explicit resume.

### 3. The registries are per-scope layered and GC-friendly
The tools/skills registries use host plus per-scope layers over dsh-scope. dsh-scope keys its carrier and parent maps with WeakMap, and registrations are effects that unwind on fiber disposal. This modular core is already memory-disciplined: layers are rebuilt lazily and disposed with their scope. Cross-scope caches (the tools registry visible view, skill collectCacheMaxEntries) are bounded or revision-invalidated.

### 4. Streaming and tool output have partial back-pressure
Two mechanisms already fight unbounded growth, but only at the model-context boundary, not the host-memory boundary:
- Compaction (compaction-basic, compaction-tool-result-pruner) condenses or prunes model-visible history under token pressure. It shrinks what the model sees; it does not shrink what the host retains (the full log stays for replay).
- Spill (spill, spill-local, spill-policy) moves oversized tool-result text to disk and leaves a locator. This is the one existing pattern of offloading large payloads off the heap, but it is scoped to tool results and opt-in.

### 5. No server-side memory instrumentation
The only perf harness is client-side (apps/web/tests/complex-history.perf.ts). There is no host RSS/heap benchmark, no per-session memory accounting, and no memory-pressure event on the bus. BENCHMARK.md points only at the Python SDK task runner.

## The core tension

The plugin model asks every capability to be a resident service with live registrations and in-memory state, reachable synchronously through ctx. Memory performance wants cold state off the heap. The gap is that today modular is conflated with resident: a session, once created, is an in-memory object graph until its fiber dies, and the seam that could page it out (persistence) is not connected to any memory signal.

The good news from the audit: the architecture is already built on the right primitives to close this without breaking modularity: append-only logs that are pure functions of durable events, a persistence seam that already rehydrates, WeakMap-keyed scopes, and an existing spill precedent.

## Gaps and proposed optimizations

Each proposal is framed as a new seam or a new event, never a privileged core path, so it stays patchable.

### Gap A: No idle-session eviction / rehydration (cold sessions)
Today: every created session is resident until fiber disposal.
Proposal: a session residency seam (ctx.sessionResidency) with a default provider that, on a configurable idle threshold, evicts a session resident log/derived caches to the already-durable persistence backend and rehydrates on next access. Because deriveMessages() is a pure re-derivation from the log, a rehydrated session is byte-identical. The store gains an eviction hook; the policy is a swappable plugin (LRU by last-access, by RSS target, by session count). Preserves modularity: eviction is a provider behind a seam; the store exposes the hook, not the policy. Reuses session-persistence rehydration; no new storage format.

### Gap B: No memory-pressure signal on the bus
Today: nothing tells plugins the host is under memory pressure.
Proposal: a runtime/memory-pressure capability event (level normal/elevated/critical), produced by a small sampler plugin reading process.memoryUsage() against configured watermarks. Compaction, the residency provider, spill policy, and caches all become consumers that shed proportionally. One signal, many independent responders: the seam pattern applied to memory.

### Gap C: Full-log residency for long sessions
Today: this.log holds every event, including verbose assistant/chunk streaming deltas, for the whole session lifetime.
Proposal: a log-tiering strategy where cold, already-persisted prefix ranges of the log are dropped from the resident array behind an accessor that transparently faults them back from persistence when a rare consumer (fork, transcript export) needs them. The hot tail (everything compaction/derivation actually touches) stays resident. Guarded by a runtime invariant that the faulted range equals the persisted range.

### Gap D: Chunk rows retained at full fidelity forever
Today: raw assistant/chunk events stay in the log for replay/UI even after the assistant/message they composed is durable.
Proposal: a chunk-retention policy seam. Once a message is sealed and persisted, its constituent chunks can be collapsed to a compact replay token on the heap (still reconstructable from persistence for exact replay). Opt-in, off by default, so replay-sensitive deployments keep full fidelity.

### Gap E: Derived-message cache duplicates frozen event content
Today: derived holds Message objects. They already share frozen event data (good), but the array itself and the per-call snapshot copy allocate.
Proposal: measure first. Add the instrumentation from Gap F, then decide whether a copy-on-read view or a generation-stamped shared snapshot is worth the complexity. Do not optimize this without numbers.

### Gap F: No host memory instrumentation (prerequisite for all of the above)
Today: no server-side memory benchmark or accounting.
Proposal (do this first):
1. A per-session memory-accounting helper (approximate retained bytes: log length, snapshot presence, derived size) exposed for telemetry, analogous to how token-meter accounts tokens.
2. A host memory benchmark (perf test in the session/agent-loop packages) that drives N concurrent long sessions and records RSS/heapUsed, so every proposal is validated against real numbers, not intuition.
3. Wire both into a MEMORY-BENCHMARK.md runbook.

## Guiding principles (so we do not trade away modularity)

1. Every optimization is a seam or an event, never a core fast-path. If a plugin cannot swap or observe it, it does not ship.
2. Purity is the enabler. The log is the source of truth and derivations are pure functions of it; that is precisely what makes eviction and tiering safe. Protect that property with invariants.
3. Measure before and after. Gap F is the prerequisite. No memory PR merges without a before/after number from the host benchmark.
4. Default to today behavior. Every new policy is opt-in or conservatively defaulted; a deployment that wants full residency keeps it.
5. Reuse existing precedents. Spill (offload-to-disk), compaction (shed under pressure), and persistence (rehydrate) already exist: extend their patterns rather than inventing parallel ones.

## Suggested sequencing

1. Gap F: instrumentation plus host benchmark (unblocks everything, low risk).
2. Gap B: memory-pressure event (small, enables consumers).
3. Gap A: idle-session residency seam (highest expected win, reuses persistence).
4. Gap C / D: log tiering and chunk retention (larger, needs A and F in place).
5. Gap E: only if instrumentation shows it matters.

## Open questions

- What concurrent-session count are we optimizing for (tens? thousands?)? This sets whether Gap A alone suffices or Gap C is mandatory.
- Is there a hard RSS ceiling per deployment we are targeting, or is the goal graceful degradation under pressure?
- Should residency eviction be cooperative with in-flight turns (never evict an active turn)? Almost certainly yes; needs an explicit invariant.

## Dev Note

This is a working draft from an architecture audit, not an implementation spec. Numbers from Gap F should replace every expected-win qualifier here before any of A through E is scheduled.
