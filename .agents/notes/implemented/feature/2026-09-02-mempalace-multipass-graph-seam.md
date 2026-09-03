# Agent Note: provider-owned palace graph exploration

Status: implemented

English | [中文](2026-09-02-mempalace-multipass-graph-seam.zh.md)

## Problem

Palace visualization needs structural data from the configured memory store, but inline graph JSON and arbitrary graph file paths let model or transport input replace the palace as the source of truth. A second MemPalace process or configuration authority would also diverge from recall and capture lifecycle.

## Decision

`MemoryRuntime.exploreGraph()` is a provider-neutral host operation. A trusted host consumer supplies only node, edge, hop, result-byte, and cancellation limits plus an optional start room. It cannot supply graph data, a path, Python, a command, or backend configuration. The operation returns `dsh.memory.graph.v1` renderer-neutral room and wing nodes, placement/tunnel/path edges, deterministic breadth-first visits, truncation, and counts.

`MemPalaceMemory` implements the operation through its existing persistent worker and configured collection. The bridge pages collection metadata directly with a fixed scan ceiling rather than calling the unbounded upstream `build_graph()`. It bounds names, scan records, nodes, edges, hops, output bytes, JSONL frame bytes, and request time. TypeScript validates every worker field and all complete-result limits again. Cancellation or malformed/oversized protocol output terminates the worker; later recall, capture, or graph work starts one replacement.

The Dashboard branch can expose a typed authenticated host endpoint that calls `ctx.memory.exploreGraph(request, signal)` and forwards the DTO unchanged to a renderer. Browser code does not receive palace paths, collection credentials, worker controls, or provider-specific objects. This branch does not add that endpoint or UI.

## Alternatives considered

**Model-facing tool** — Rejected. Structural visualization is a host/UI need, and a model tool would retain large graph results in session history without granting a necessary model capability.

**Inline JSON or graph file path** — Rejected because either makes caller-controlled data appear to be the configured palace and grants unnecessary file authority.

**Second export process or local server** — Rejected because it duplicates provider discovery, backend selection, collection ownership, timeout, and teardown.

**Upstream `build_graph()`** — Rejected for this operation because it can page the complete palace before DSH can enforce result limits. The reviewed bridge operation stops after a configured metadata scan ceiling.

## Consequences

Graph acquisition shares the native provider's process, backend, collection, health, cancellation, restart, flush, and disposal lifecycle. Results are deterministic for a stable backend page order and contain no renderer coordinates. Partial scans or any node, edge, or byte trimming set `truncated`; callers can render partial state explicitly. Providers implementing `MemoryRuntime` must implement the graph operation, even if they reject it as unsupported.
