---
description: "Package map for automatic long-term memory: the provider-neutral service, lifecycle consumer, and native MemPalace backend."
kind: "package-group"
---

# memory/ — automatic long-term memory

English | [中文](README.zh.md)

## Summary

The `memory/` group gives Temple-DSH automatic long-term recall, completed-turn capture, and host graph exploration without model tool calls. The provider-neutral service keeps lifecycle policy and host graph acquisition independent from storage; the MemPalace provider runs direct MemPalace APIs in one managed Python sidecar. The capability is opt-in and does not use MCP.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Provider-neutral recall, capture, bounded graph, status, and flush contract | `ctx.memory` |
| [`memory-context/`](memory-context/README.md) | Automatic first-step recall and completed-turn capture | consumes `ctx.memory` |
| [`memory-mempalace/`](memory-mempalace/README.md) | Persistent native MemPalace provider | provides `ctx.memory` |

## Related documentation

- [Memory subsystem](../../docs/subsystems/memory.md) — lifecycle and service contract.
- [Native MemPalace decision](../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.md) — capability boundaries and safety choices.
- [Provider-owned palace graph decision](../../.agents/notes/implemented/feature/2026-09-02-mempalace-multipass-graph-seam.md) — bounded host acquisition and intended Dashboard seam.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
