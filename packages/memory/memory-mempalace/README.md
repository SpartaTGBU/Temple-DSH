---
description: "Persistent direct-API MemPalace provider for automatic Temple-DSH memory, with managed JSONL process lifecycle."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-mempalace

English | [中文](README.zh.md)

## Summary

`dsh-memory-mempalace` provides `ctx.memory` through direct MemPalace Python APIs. One lazy persistent worker serves recall and capture requests over a private bounded JSONL protocol. It is not an MCP server and registers no model-facing tools.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Install MemPalace into the configured Python environment, mount this provider before `dsh-memory-context`, and explicitly enable the pair. The base profiles support `MEMPALACE_ENABLED=1`, `MEMPALACE_PYTHON`, `MEMPALACE_PALACE_PATH`, `MEMPALACE_COLLECTION`, `MEMPALACE_BACKEND`, and `MEMPALACE_WING`. The standalone example is [`mempalace-native.cordis.yml`](../../../apps/cli/config/examples/memory/mempalace-native.cordis.yml).

The provider keeps a bounded capture queue, restarts the worker after timeout or malformed protocol output, applies recall/result limits again at the TypeScript boundary, and drains accepted capture work on flush and disposal. Child stderr and credentials never enter recall results or model-visible errors.

<a id="understand-the-implementation"></a>
## Understand the implementation

The TypeScript provider uses `ctx.subprocess` with an argv array and piped stdio. [`resources/bridge.py`](resources/bridge.py) imports MemPalace directly, reuses one backend collection, calls `search_memories` for recall, and calls `file_conversation_exchange` for capture into the configured wing's `conversations` room.

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Native MemPalace decision](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.md)

<a id="dev-note"></a>
## Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

### Provider behavior

#### What the model sees

Nothing directly. `dsh-memory-context` decides whether bounded MemPalace recall enters a request; this provider has no tool or prompt of its own.

#### Token effect

Zero direct tokens. Recall text is data-dependent and bounded again at the TypeScript provider boundary before the consumer receives it.

#### KV Cache effect

No direct effect. The consumer owns request-context insertion.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- MemPalace and its embedding/backend dependencies remain external Python dependencies.
- The first Chroma operation may initialize or download its embedding model and can take longer than steady-state requests.
- Capture queue overflow rejects new work explicitly rather than dropping old accepted turns.
