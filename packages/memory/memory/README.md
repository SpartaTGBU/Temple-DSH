---
description: "The provider-neutral ctx.memory contract for automatic recall, completed-turn capture, health, and draining."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` defines `ctx.memory`, the swappable long-term-memory service used by lifecycle consumers. It stores nothing itself and exposes no model-facing tool. A provider supplies bounded recall, asynchronous completed-turn capture, non-secret status, and an awaited flush.

## Use this package

Consumers call `recall` with a query, item limit, and byte limit; call `captureTurn` with one complete user/assistant exchange; and call `flush` before teardown or when durable completion is required. Providers must preserve cancellation on recall and must not expose credentials or raw backend diagnostics through status.

## Understand the implementation

The abstract `MemoryRuntime` is registered as `ctx.memory`. Request and result objects carry only provider-neutral fields, so consumers do not import MemPalace.

## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Memory package map](../README.md)

## Model Experience

Indirect. A lifecycle consumer injects recalled context; this service contributes no prompt, message, schema, or tool itself.

#### KV Cache effect

A consumer's first-step recall appends variable context after stable conversation history and therefore changes that request suffix.

## Known Limitations and Deferred Work

- A composition mounts one memory provider because `ctx.memory` is a single service.
- The contract does not define a memory administration UI or model tool.

## Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>
