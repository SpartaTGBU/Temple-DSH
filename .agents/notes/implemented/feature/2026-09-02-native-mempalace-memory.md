# Agent Note: native MemPalace automatic memory

Status: implemented

English | [中文](2026-09-02-native-mempalace-memory.zh.md)

## Problem

Explicit model-facing memory tools cannot guarantee recall before a request or capture after a completed turn. Starting Python for every operation also repeats backend and embedding initialization, while an MCP server would add a second application and lifecycle authority.

## Decision

Temple-DSH treats long-term memory as a native capability. A provider-neutral `ctx.memory` service separates storage from agent lifecycle behavior. The `memory-context` consumer recalls once before the first model request of a turn and captures one successful completed exchange asynchronously. The MemPalace provider calls direct Python APIs through one managed persistent sidecar.

Recall context is bounded and explicitly untrusted. Only direct-user text forms queries; capture excludes plugin context, reasoning, and tool traffic. Subagent capture is opt-in. The append-only session log changes only through the ordinary source-attributed recall message admitted by the pre-step pipeline.

The process uses argv execution without a shell, request-id JSONL frames, response-size caps, cancellation deadlines, a bounded capture queue, graceful flush, and process-tree teardown. Raw stderr and credentials never become model context. [Provider-owned palace graph exploration](2026-09-02-mempalace-multipass-graph-seam.md) extends the same service and worker without adding a model tool or second process.

## Alternatives considered

**MCP or model-facing memory tools** — Rejected because the model could omit required recall or capture, and a server would duplicate application lifecycle.

**One Python process per operation** — Rejected because repeated backend collection and embedding initialization increases latency and resource use.

## Consequences

One configured provider owns recall, capture, status, flush, graph acquisition, backend selection, and worker teardown. Provider failure degrades automatic recall without failing the model turn; accepted capture work is bounded and flushed. Focused tests cover first-step recall, injection limits, timeout degradation, exactly-once capture, subagent filtering, worker reuse/restart, queue overflow, flush, and disposal. A fixture executes the packaged bridge against direct MemPalace-compatible APIs; a real installed Chroma round trip remains environment-dependent.
