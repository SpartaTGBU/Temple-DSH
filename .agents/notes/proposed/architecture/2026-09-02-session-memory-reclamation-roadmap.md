# Agent Note: Session memory reclamation roadmap

Status: proposed

English | [中文](2026-09-02-session-memory-reclamation-roadmap.zh.md)

## Problem

The session-memory packages provide measurement, pressure detection, candidate selection, and safe cache release, but a live `Session` still owns its complete append-only event log. The current names can make planning and analysis look like reclamation: the residency policy delegates to an executor, and the shipped executor releases only rebuildable caches; the log-tiering and chunk-reclaim modules calculate hypothetical representation savings without changing a session. Maintainers need one current decision record that separates estimates, reference release, garbage collection, and operating-system memory return.

## Present state

| Area | Shipped behavior | Boundary |
|---|---|---|
| Measurement | The [memory meter](../../../../packages/util/memory-meter/README.md) estimates serialized event bytes, ranks sessions, and includes a host RSS/heap benchmark. | The estimate is not an exact retained-size walk. |
| Pressure | The [memory-pressure detector](../../../../packages/runtime-diagnostics/memory-pressure/README.md) classifies V8 `heapUsed`, emits level transitions, and exposes the current level. | It neither observes RSS or external memory nor sheds memory. A sustained level emits no repeated trigger. |
| Residency policy | The [residency policy](../../../../packages/session/session-residency/README.md) ranks idle sessions, excludes open turns, and delegates selected candidates to one executor. | It neither owns store lifecycle nor implements transparent rehydration. No shipped profile currently assembles this package chain. |
| Cache release | The [cache-release executor](../../../../packages/session/session-residency-cache-release/README.md) calls `Session.releaseCaches()` to drop the `Session`'s references to its event snapshot, derived-message projection, and request-context fold. | Those cache objects become eligible for garbage collection only when no caller retains them. The complete event log and `Session` remain reachable, and neither immediate `heapUsed` reduction nor RSS return is guaranteed. |
| Derived history | The [session API](../../../../docs/subsystems/session.md) exposes `deriveMessagesShared()` and lazily rebuildable caches. | The shared array avoids per-call copies; it does not reduce the resident log. |
| Persistence | The [persistence seam](../../../../packages/session/session-persistence/README.md) loads durable logs for explicit cold resume, and its backends may pack chunk runs on disk. | A live store entry cannot become dormant and fault itself back on access. Disk packing does not compact the resident event array. |
| Analysis | The memory meter's `chunk-reclaim` and `log-tiering` entries compare serialized packed-chunk and cold-prefix representations. | Both analyzers are pure and non-mutating. Their byte deltas are planning estimates, not retained-heap measurements, and they release no references. |
| Long-term memory | The [native MemPalace capability](../../../../docs/subsystems/memory.md) recalls and captures provider-neutral semantic memory. | It is independent of session-log residency and is not an eviction or rehydration backend. |

The shipped seams are useful foundations, but they are not an end-to-end resident-log eviction feature. Ordinary persistence resume proves that a durable log can reconstruct a session; it does not prove transparent rehydration while an existing agent, scope, or caller may retain the old `Session` object. In this note, reclamation means making an object graph unreachable so a forced post-operation collection can show reduced `heapUsed`; RSS is a separate allocator and operating-system outcome and may remain unchanged after collection.

## Proposal

Treat whole-session eviction and transparent rehydration as the only active proposal for making a complete live session object graph unreachable. Implement it only for a named long-running composition with representative, forced-GC benchmark evidence that cache release leaves resident logs as a material source of pressure. Preserve the plugin boundary: selection remains in the residency policy, the drop mechanism remains behind `ResidencyExecutor`, and no persistence backend or pressure detector gains a privileged store path. The executor also needs an explicit store/agent lifecycle contract: a selected idle session with no open turn reaches a durability checkpoint, atomically becomes dormant, releases every store- and agent-owned reference, and reconstructs one live instance from persistence on the next supported operation. An external caller that retains the old object prevents collection, so the contract must also revoke that object's mutation authority rather than claim it was reclaimed.

Do not schedule resident log tiering or resident chunk compaction as parallel work. Re-evaluate log tiering only if active sessions remain too large after whole-session eviction; partial logs conflict with the current synchronous `events`, sequence-index, surface, fork, export, and observer contracts. Re-evaluate resident chunk compaction only if process measurements isolate chunk event rows as the remaining cost; storage codecs already pack chunks, while an in-memory packed representation would need a virtual event view that preserves exact replay and sequence identity. The existing analyzers supply serialized-size estimates for those decisions, not implementations.

The immediate integration step is to assign a deployment owner, name its target concurrency and memory objective, assemble the pressure/policy/cache-release chain in that composition, and record pre-release, post-release, and post-forced-GC `heapUsed` plus RSS for the same workload. The composition must define how another bounded pass occurs while pressure remains elevated, because the detector emits transitions rather than periodic level events and one policy pass is capped. Use spill for oversized tool payloads and context compaction for model-visible token pressure; neither substitutes for resident-log reclamation. Until the integration and evidence exist, keep the packages opt-in and describe them as measurement, signaling, selection, and cache-reference-release seams rather than a general memory-management feature.

## Alternatives considered

**Stop at cache release.** This is the lowest-risk default and may be sufficient for modest workloads, but it cannot bound memory when event logs dominate long-lived sessions. Keep it as the shipped behavior, not as proof that full eviction is complete.

**Implement log tiering or chunk compaction first.** These mechanisms can help one large active session, but they introduce a partial-log representation into contracts built around one contiguous synchronous array. Whole-session eviction preserves the existing `Session` representation and should receive benchmark priority.

**Use context compaction or MemPalace as reclamation.** Context compaction changes the model-visible surface while retaining shadowed raw events, and MemPalace stores semantic long-term memory. Neither removes the resident session log.

**Evict directly inside the pressure detector or residency policy.** This would couple detection or selection to persistence and store lifecycle. The existing detector, policy, and executor boundary preserves replaceability and remains the correct ownership split.

## Acceptance criteria

- A representative long-running composition extends the shipped host benchmark or uses an equivalent controlled process test to exercise both cache release and full eviction; after forced collection, full eviction materially reduces `heapUsed` beyond cache release alone. The report records RSS separately without treating page return as a correctness condition.
- An idle session with no open turn reaches durable storage before its resident object graph becomes unreachable; eviction fails without discarding the live instance when durability fails.
- The next supported lookup or operation rehydrates exactly one live session whose events, surface, derived messages, header, and sequence continuation match the pre-eviction state.
- Candidate eligibility is revalidated at the eviction commit point so a turn or append that begins after selection cannot race the drop.
- Lifecycle, concurrent access, fork/export, and disposal semantics are explicit and tested; a stale `Session` reference rejects mutation and cannot split history from the replacement instance.
- Documentation continues to label memory pressure and analyzers as signals and measurements, never as reclamation.

## Risks

Transparent rehydration crosses the current fiber-owned session and agent lifecycle. Retained object references can defeat garbage collection or split one session identity across two instances, while a pressure-triggered durability checkpoint can add latency or fail under the same resource stress. A store proxy or dormant entry may also widen synchronous APIs into asynchronous ones. If the target composition cannot define these semantics without weakening session identity and append ordering, retain cache release and reject full eviction rather than hiding the conflict.