---
description: "The provider-neutral ctx.memory contract for automatic recall, completed-turn capture, health, and draining."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` defines `ctx.memory`, the swappable long-term-memory service used by lifecycle consumers. It stores nothing itself and exposes no model-facing tool. A provider supplies bounded recall, asynchronous completed-turn capture, non-secret status, and an awaited flush.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Consumers call `recall` with a query, item limit, and byte limit; call `captureTurn` with one complete user/assistant exchange; and call `flush` before teardown or when durable completion is required. Providers must preserve cancellation on recall and must not expose credentials or raw backend diagnostics through status.

<a id="understand-the-implementation"></a>
## Understand the implementation

The abstract `MemoryRuntime` is registered as `ctx.memory`. Request and result objects carry only provider-neutral fields, so consumers do not import MemPalace.

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Memory package map](../README.md)

<a id="dev-note"></a>
## Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

### Service definition

#### What the model sees

Nothing directly. `ctx.memory` is a provider-neutral runtime contract; a lifecycle consumer owns any recalled message.

#### Token effect

Zero direct tokens. Implementations return bounded data to their consumer rather than adding model context themselves.

#### KV Cache effect

No direct effect. A consumer may append variable recall after stable conversation history and change that request suffix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A composition mounts one memory provider because `ctx.memory` is a single service.
- The contract does not define a memory administration UI or model tool.
