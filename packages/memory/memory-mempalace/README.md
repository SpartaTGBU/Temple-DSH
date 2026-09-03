---
description: "Persistent direct-API MemPalace provider for automatic Temple-DSH memory, with managed JSONL process lifecycle."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-mempalace

English | [中文](README.zh.md)

## Summary

`dsh-memory-mempalace` provides `ctx.memory` through direct MemPalace Python APIs. One lazy persistent worker serves recall and capture requests over a private bounded JSONL protocol. It is not an MCP server and registers no model-facing tools.

## Use this package

Install MemPalace into the configured Python environment, mount this provider before `dsh-memory-context`, and explicitly enable the pair. The base profiles support `MEMPALACE_ENABLED=1`, `MEMPALACE_PYTHON`, `MEMPALACE_PALACE_PATH`, `MEMPALACE_COLLECTION`, `MEMPALACE_BACKEND`, and `MEMPALACE_WING`. The standalone example is [`mempalace-native.cordis.yml`](../../../apps/cli/config/examples/memory/mempalace-native.cordis.yml).

The provider keeps a bounded capture queue, restarts the worker after timeout or malformed protocol output, applies recall/result limits again at the TypeScript boundary, and drains accepted capture work on flush and disposal. Its `inspectionSource()` operation resolves the palace, collection, storage backend, and capture wing through the same bridge configuration without opening or creating storage. Child stderr, free-form provider details, and credentials never enter dashboard or model-visible errors.

## Understand the implementation

The TypeScript provider uses `ctx.subprocess` with an argv array and piped stdio. [`resources/bridge.py`](resources/bridge.py) imports MemPalace directly, reuses one backend collection, calls `search_memories` for recall, and calls `file_conversation_exchange` for capture into the configured wing's `conversations` room.

## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Native MemPalace decision](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.md)

## Model Experience

Indirect through `dsh-memory-context`; this provider has no tool or prompt of its own.

#### KV Cache effect

No direct effect. The consumer owns request-context insertion.

## Known Limitations and Deferred Work

- MemPalace and its embedding/backend dependencies remain external Python dependencies.
- The first Chroma operation may initialize or download its embedding model and can take longer than steady-state requests.
- Capture queue overflow rejects new work explicitly rather than dropping old accepted turns.

## Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>
