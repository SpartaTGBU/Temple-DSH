# Native MemPalace automatic memory

English | [中文](2026-09-02-native-mempalace-memory.zh.md)

## Decision

Temple-DSH treats long-term memory as a native capability rather than a model-facing MCP tool. A provider-neutral `ctx.memory` service separates storage from agent lifecycle behavior. The `memory-context` consumer recalls once before the first model request of a turn and captures one successful completed exchange asynchronously. The MemPalace provider calls direct Python APIs through one managed persistent sidecar.

## Boundaries

Recall context is bounded and explicitly untrusted. Only direct-user text forms queries; capture excludes plugin context, reasoning, and tool traffic. Subagent capture is opt-in. The append-only session log remains unchanged except for the ordinary source-attributed recall message already admitted by the pre-step pipeline.

The process boundary uses argv execution without a shell, request-id JSONL frames, response-size caps, cancellation deadlines, a bounded capture queue, graceful flush, and process-tree teardown. Raw stderr and credentials never become model context.

## Alternatives

An MCP wrapper required explicit tool calls and exposed memory as a model choice, so it could not guarantee recall or capture. One Python process per operation simplified isolation but multiplied startup and embedding initialization cost. The persistent sidecar keeps one backend collection while preserving Temple-DSH process ownership.

## Verification

Focused tests exercise first-step recall, injection bounds, timeout degradation, exactly-once capture, subagent filtering, worker reuse, restart after timeout or malformed output, queue overflow, flush, and disposal. A live Chroma round trip captures and recalls a known value through the packaged bridge.
