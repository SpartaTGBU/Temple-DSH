# Agent Note: MemPalace multipass graph seam

Status: implemented

English | [中文](2026-09-02-mempalace-multipass-graph-seam.zh.md)

## Problem

MemPalace exposes palace navigation through `palace_graph.build_graph()`, `traverse()`, and tunnel helpers, but DSH needs an opt-in integration that can explore that graph without becoming a second memory provider or executing arbitrary local code. A broad dashboard or provider would mix mining, recall, storage, and visualization concerns into one package and would overstate what upstream MemPalace currently exposes as a stable DSH service.

## Decision

DSH ships `@deepseek-ai/dsh-tool-mempalace-multipass` as a model-facing opt-in tool package. The package accepts MemPalace `build_graph()` JSON as `{ nodes, edges }`, `[nodes, edges]`, or an already-written local JSON file, validates it at the file/tool boundary, and normalizes it into `dsh.mempalace.multipass.graph.v1`. The export contains sorted room, wing, tunnel, bounded path, and renderer-neutral visualization DTOs. The tool does not run MemPalace, import Python, start a local service, fetch browser assets, or evaluate graph scripts.

## Integration seam

The seam is the graph export, not memory storage. MemPalace remains the owner of mining, palace persistence, drawer recall, hallway/tunnel construction, and Python traversal helpers. DSH owns only local JSON ingestion, stable TypeScript DTOs, tool lifecycle, and deterministic visualization hints a future UI can render. File ingestion is size-bounded and JSON-only, so a caller that wants live MemPalace state must produce the JSON outside this package through a reviewed workflow.

## Alternatives considered

**General memory provider** — Rejected because this branch is scoped to multi-hop palace exploration and graph visualization. A provider would need storage, recall, durability, privacy, and model-context contracts that are larger than the available upstream graph seam.

**Maintenance dashboard** — Rejected because status, repair, mining, and dashboard workflows belong to a different MemPalace integration. Adding them here would make the graph exploration package load more authority than it needs.

**Run a configurable MemPalace command** — Rejected for this package because arbitrary command execution would create a local code-execution surface and would require Python environment discovery. A future provider can add a reviewed fixed command if upstream ships a JSON graph export command.

**Bundle a browser renderer** — Rejected because the host package can expose a renderer-neutral DTO without choosing a CDN or vendored JavaScript asset. The consuming UI owns that tradeoff and can apply its own script review policy.

## Consequences

The integration is safe to compose locally and easy to remove: disposing the plugin unregisters the tool and leaves no background service. The cost is that the user or another trusted package must produce `build_graph()` JSON before DSH can explore it. Tests pin graph normalization, isolated wings and rooms, tunnel and path derivation, invalid input rejection, file ingestion, and registry cleanup.
