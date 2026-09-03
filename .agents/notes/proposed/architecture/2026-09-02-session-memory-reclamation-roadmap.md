# Agent Note: Session memory reclamation roadmap

Status: proposed

English | [中文](2026-09-02-session-memory-reclamation-roadmap.zh.md)

## Problem

The session-memory packages provide measurement, pressure detection, candidate selection, and safe cache release, but a live `Session` still owns its complete append-only event log. The current names can make planning and analysis look like physical reclamation: the residency policy delegates to an executor, and the shipped executor releases only rebuildable caches; the log-tiering and chunk-reclaim modules calculate hypothetical savings without changing a session. Maintainers need one current decision record that separates those foundations from mechanisms that can actually remove log rows from heap.

## Present state

| Area | Shipped behavior | Boundary |
|---|---|---|
| Measurement | The [memory meter](../../../../packages/util/memory-meter/README.md) estimates serialized event bytes, ranks sessions, and includes a host RSS/heap benchmark. | The estimate is not an exact retained-size walk. |
| Pressure | The [memory-pressure detector](../../../../packages/runtime-diagnostics/memory-pressure/README.md) emits level transitions and exposes the current level. | It detects pressure but never sheds memory. |
| Residency policy | The [residency policy](../../../../packages/session/session-residency/README.md) ranks idle sessions, excludes open turns, and delegates selected candidates to one executor. | It neither owns store lifecycle nor implements transparent rehydration. No shipped profile currently assembles this package chain. |
| Cache release | The [cache-release executor](../../../../packages/session/session-residency-cache-release/README.md) calls `Session.releaseCaches()` to drop the event snapshot, derived-message projection, and request-context fold. | This is physical reclamation of volatile caches only; the complete event log and `Session` remain resident. |
| Derived history | The [session API](../../../../docs/subsystems/session.md) exposes `deriveMessagesShared()` and lazily rebuildable caches. | The shared array avoids per-call copies; it does not reduce the resident log. |
| Persistence | The [persistence seam](../../../../packages/session/session-persistence/README.md) loads durable logs for explicit cold resume, and its backends may pack chunk runs on disk. | A live store entry cannot become dormant and fault itself back on access. Disk packing does not compact the resident event array. |
| Analysis | The memory meter's `chunk-reclaim` and `log-tiering` entries estimate hypothetical packed-chunk and cold-prefix bytes. | Both analyzers are pure and non-mutating. They reclaim zero bytes. |
| Long-term memory | The [native MemPalace capability](../../../../docs/subsystems/memory.md) recalls and captures provider-neutral semantic memory. | It is independent of session-log residency and is not an eviction or rehydration backend. |

The shipped seams are useful foundations, but they are not an end-to-end resident-log eviction feature. Ordinary persistence resume proves that a durable log can reconstruct a session; it does not prove transparent rehydration while an existing agent, scope, or caller may retain the old `Session` object.

## Proposal

Treat whole-session eviction and transparent rehydration as the only active physical-reclamation proposal. Implement it only for a named long-running composition with representative benchmark evidence that cache release leaves resident logs as a material source of pressure. The implementation belongs behind the existing `ResidencyExecutor`, but it also needs an explicit store/agent lifecycle contract: a selected closed, idle session reaches a durability checkpoint, releases all live references that keep its object graph reachable, leaves a dormant identity that can be resolved, and reconstructs one live instance from persistence on the next supported operation.

Do not schedule resident log tiering or resident chunk compaction as parallel work. Re-evaluate log tiering only if active sessions remain too large after whole-session eviction; partial logs conflict with the current synchronous `events`, sequence-index, surface, fork, export, and observer contracts. Re-evaluate resident chunk compaction only if measurements isolate chunk objects as the remaining cost; storage codecs already pack chunks, while an in-memory packed representation would need a virtual event view that preserves exact replay and sequence identity. The existing analyzers supply estimates for those decisions, not implementations.

The immediate integration step is to assign a deployment owner, assemble the pressure/policy/cache-release chain in that composition, and record benchmark results for its workload. Until that happens, keep the packages opt-in and describe them as measurement and policy seams rather than a general memory-management feature.

## Alternatives considered

**Stop at cache release.** This is the lowest-risk default and may be sufficient for modest workloads, but it cannot bound memory when event logs dominate long-lived sessions. Keep it as the shipped behavior, not as proof that full eviction is complete.

**Implement log tiering or chunk compaction first.** These mechanisms can help one large active session, but they introduce a partial-log representation into contracts built around one contiguous synchronous array. Whole-session eviction preserves the existing `Session` representation and should receive benchmark priority.

**Use context compaction or MemPalace as reclamation.** Context compaction changes the model-visible surface while retaining shadowed raw events, and MemPalace stores semantic long-term memory. Neither removes the resident session log.

**Evict directly inside the pressure detector or residency policy.** This would couple detection or selection to persistence and store lifecycle. The existing detector, policy, and executor boundary preserves replaceability and remains the correct ownership split.

## Acceptance criteria

- A representative long-running composition demonstrates, with the shipped host benchmark or equivalent process measurements, that full eviction materially improves RSS or heap beyond cache release alone.
- An idle session with no open turn reaches durable storage before its resident object graph becomes unreachable; eviction fails without discarding the live instance when durability fails.
- The next supported lookup or operation rehydrates exactly one live session whose events, surface, derived messages, header, and sequence continuation match the pre-eviction state.
- Lifecycle, concurrent access, fork/export, and disposal semantics are explicit and tested; no stale `Session` reference can append to a replacement instance.
- Documentation continues to label memory pressure and analyzers as signals and measurements, never as reclamation.

## Risks

Transparent rehydration crosses the current fiber-owned session and agent lifecycle. Retained object references can defeat garbage collection or split one session identity across two instances, while a pressure-triggered durability checkpoint can add latency or fail under the same resource stress. A store proxy or dormant entry may also widen synchronous APIs into asynchronous ones. If the target composition cannot define these semantics without weakening session identity and append ordering, retain cache release and reject full eviction rather than hiding the conflict.