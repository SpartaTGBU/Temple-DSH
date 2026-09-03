---
description: "The provider-neutral ctx.memory contract for recall, capture, bounded graph exploration, health, and draining."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` defines `ctx.memory`, the swappable long-term-memory service used by lifecycle and host consumers. It stores nothing itself and exposes no model-facing tool. A provider supplies bounded recall, asynchronous completed-turn capture, bounded renderer-neutral graph exploration, non-secret status, and an awaited flush.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Consumers call `recall` with a query, item limit, and byte limit; call `exploreGraph` with strict node, edge, hop, and serialized-byte limits; call `captureTurn` with one complete user/assistant exchange; and call `flush` before teardown or when durable completion is required. Providers preserve cancellation and never accept graph data, local paths, commands, or executables through the graph request.

## Understand the implementation

The abstract `MemoryRuntime` is registered as `ctx.memory`. Request and result objects carry only provider-neutral fields, so consumers do not import MemPalace.

## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Memory package map](../README.md)

## Model Experience

Indirectly, through lifecycle consumers that inject recalled context; this service contributes no prompt, message, schema, or tool itself.

#### KV Cache effect

A consumer's first-step recall appends variable context after stable conversation history and therefore changes that request suffix.

## Known Limitations and Deferred Work

- A composition mounts one memory provider because `ctx.memory` is a single service.
- The contract does not define a memory administration UI or model tool.

<a id="dev-note"></a>
### Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>
