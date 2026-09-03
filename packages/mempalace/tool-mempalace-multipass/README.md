---
description: "Opt-in MemPalace build_graph-compatible graph normalization and multi-hop exploration for DSH."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-mempalace-multipass

English | [中文](README.zh.md)

## Summary

`dsh-tool-mempalace-multipass` registers one opt-in tool, `mempalace_multipass_explore`, for local exploration of MemPalace palace graphs. It accepts JSON compatible with MemPalace `palace_graph.build_graph()` output, either directly as `{ nodes, edges }` or `[nodes, edges]`, or from a local JSON file. It validates the input, normalizes it into a stable typed export, derives bounded multi-hop room paths, and returns renderer-neutral 3D/graph data. It does not implement a general memory provider, does not mine or search drawers, and does not execute MemPalace code.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load the package only in a composition that wants MemPalace graph exploration. The shipped default bundles do not include it.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-mempalace-multipass'
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | Cooperative tool-call timeout budget in milliseconds |
| `maxGraphBytes` | `5000000` | Maximum size for a file supplied through `graph_json_path` |
| `maxRooms` | `500` | Maximum number of normalized MemPalace rooms accepted by one call |
| `defaultMaxHops` | `2` | BFS hop depth used when a call supplies `start_room` without `max_hops` |

### Input JSON

The tool accepts the JSON form of MemPalace `palace_graph.build_graph()` output:

```json
{
  "nodes": {
    "auth": { "wings": ["project_a", "project_b"], "halls": ["design"], "count": 3, "dates": ["2026-09-01"] }
  },
  "edges": [
    { "room": "auth", "wing_a": "project_a", "wing_b": "project_b", "hall": "design", "count": 3 }
  ]
}
```

It also accepts `[nodes, edges]`, matching the tuple shape after JSON serialization. If `edges` is omitted, the tool derives passive tunnel edges from multi-wing room nodes. This is a DSH normalization convenience, not an upstream MemPalace API claim.

### Local exploration workflow

Call `mempalace_multipass_explore` with exactly one of `graph_json` or `graph_json_path`. Use `start_room` and `max_hops` to request bounded multi-hop path data. The file-backed path reads an existing local JSON file only; it never shells out, imports Python, starts a server, fetches remote scripts, or evaluates browser code.

### Visualization data

The returned `visualization` field contains deterministic `nodes` and `links` for a local renderer. A browser asset is deliberately not bundled: deployments can render the DTO with their preferred offline library or a reviewed CDN import. CDN assets reduce package size but make availability and script trust depend on the configured origin; offline vendored assets increase review surface and package size but keep execution local. Either choice belongs to the consuming UI, not this host tool.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool keeps MemPalace integration at the graph export seam. MemPalace owns mining, storage, traversal helpers, and `build_graph()`. This package owns only DSH-side validation, stable sorting, typed export names, local file size bounds, and tool lifecycle.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis plugin, config schema, tool registration, local file input |
| [`src/normalize.ts`](src/normalize.ts) | Parser, validation, normalization, path derivation, visualization DTO |
| [`src/types.ts`](src/types.ts) | Stable export interfaces and format marker |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Capability seams](../../../docs/architecture.md#capability-seams) — why the integration is an opt-in tool package rather than a loop patch.
- [Tool authoring reference](../../../docs/cookbook/adding-a-tool.md) — tool schema, output, and lifecycle contracts.
- MemPalace `mempalace/palace_graph.py` — upstream source for `build_graph()` return fields.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`mempalace_multipass_explore` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mempalace-multipass). Its schema asks for exactly one of `graph_json` or `graph_json_path`, plus optional `start_room` and `max_hops`. The description states that the tool does not execute MemPalace or arbitrary code.

#### Token effect

Fixed schema cost while the package is loaded. Calls retain the supplied graph input path or inline JSON and the normalized JSON result until compaction.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged. Loading, unloading, or changing the package version can invalidate reuse from the tool-schema section.

### Tool result

#### What the model sees

A successful result is JSON with `format: "dsh.mempalace.multipass.graph.v1"`, normalized `rooms`, `tunnels`, `wings`, optional `paths`, `visualization`, and `stats`. Validation and file failures become ordinary tool errors with `mempalace_multipass:` messages.

#### Token effect

Data-dependent and bounded by configured `maxRooms`, file size, and hop depth. The complete JSON result is retained like other tool output.

#### KV Cache effect

Append-only; newly visible call arguments and results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the package's current integration seam.

- **No live MemPalace process execution** — the package reads already-produced JSON or direct JSON. This avoids arbitrary code execution and keeps the package independent of Python environment discovery, but a user must produce the `build_graph()` JSON outside DSH.
- **No general memory provider** — the package does not mine, store, search, or recall drawers. Those operations remain MemPalace responsibilities and outside this branch's scope.
- **No bundled browser renderer** — the package returns renderer-neutral 3D/graph DTOs only. A consuming UI must choose reviewed offline assets or a deliberate CDN policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

A future provider package could acquire graphs through a reviewed MemPalace JSON command if upstream exposes one. Do not add arbitrary command execution to this tool to bridge that gap.

</details>
