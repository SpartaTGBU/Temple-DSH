---
description: "The MemPalace package group: opt-in graph-exploration adapters that consume MemPalace-owned palace graph exports."
kind: "package-group"
---

# packages/mempalace

English | [中文](README.zh.md)

## Summary

The MemPalace group contains opt-in packages that consume MemPalace-owned exports without becoming a DSH memory provider. Its current package reads `palace_graph.build_graph()` JSON and registers a model-facing graph exploration tool. MemPalace remains responsible for mining, persistence, drawer recall, and traversal helpers; DSH owns only the host-side tool contract, validation, and normalized result DTOs.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-mempalace-multipass`](tool-mempalace-multipass/README.md) | Normalizes MemPalace build_graph-compatible JSON and exposes bounded multi-hop room exploration | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Capability seams](../../docs/architecture.md) — why the package is an opt-in tool rather than a loop patch or storage provider.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-mempalace-multipass) — the `mempalace_multipass_explore` schema the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-tool-mempalace-multipass) — every accepted config field.
- [MemPalace multipass graph seam Agent Note](../../.agents/notes/implemented/feature/2026-09-02-mempalace-multipass-graph-seam.md) — the integration decision and alternatives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No subsystem page owns this group yet because the current package is a single opt-in tool over an external JSON export, not a full DSH subsystem.

</details>
