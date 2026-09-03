# Agent Note: Native MemPalace automatic memory

Status: implemented

English | [中文](2026-09-02-native-mempalace-memory.zh.md)

## Problem

An explicit model-facing memory tool cannot guarantee recall before a request or capture after a completed turn. Starting one Python process per operation also repeats runtime and embedding initialization, while importing MemPalace into the Node process would erase the runtime boundary.

## Decision

Temple-DSH treats long-term memory as a native capability rather than a model-facing MCP tool. A provider-neutral `ctx.memory` service separates storage from agent lifecycle behavior. The `memory-context` consumer recalls once before the first model request of a turn and captures one successful completed exchange asynchronously. The MemPalace provider calls direct Python APIs through one managed persistent sidecar.

Recall context is bounded and explicitly untrusted. Only direct-user text forms queries; capture excludes plugin context, reasoning, and tool traffic. Subagent capture is opt-in. The append-only session log remains unchanged except for the ordinary source-attributed recall message admitted by the pre-step pipeline.

The process boundary uses argv execution without a shell, request-id JSONL frames, response-size caps, cancellation deadlines, a bounded capture queue, graceful flush, and process-tree teardown. Raw stderr and credentials never become model context.

## Alternatives considered

**Use an MCP wrapper.** MCP requires explicit tool calls and exposes memory as a model choice, so it cannot guarantee recall or capture.

**Start one Python process per operation.** Per-operation processes simplify isolation but multiply startup and embedding initialization cost. The persistent sidecar keeps one backend collection while preserving Temple-DSH process ownership.

## Consequences

The provider and lifecycle consumer remain explicit opt-ins. Recall failure degrades to the original request, accepted captures drain through the bounded queue, and disposal joins the managed sidecar. Focused tests exercise first-step recall, injection bounds, timeout degradation, exactly-once capture, subagent filtering, worker reuse, restart after timeout or malformed output, queue overflow, flush, and disposal. A live Chroma round trip captures and recalls a known value through the packaged bridge.
