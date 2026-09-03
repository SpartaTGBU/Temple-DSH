---
description: "Automatic first-step long-term-memory recall and exactly-once completed-turn capture for Temple-DSH agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

English | [中文](README.zh.md)

## Summary

`dsh-memory-context` makes `ctx.memory` seamless: the first eligible step of a turn recalls relevant background automatically, and a successfully completed turn is queued for capture exactly once. The model never calls a memory tool. Recall failure degrades to the original request, while capture runs outside the model path.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after one `ctx.memory` provider. `recallLimit`, `maxRecallBytes`, and `recallTimeoutMs` bound latency and context. `captureSubagents` defaults to false to keep delegated or synthetic sessions from polluting user memory.

Recalled text is source-attributed as `memory-context` and begins with an explicit untrusted-data warning. Only direct user text forms the recall query and capture input; plugin messages, reasoning blocks, tools, and images are excluded. Only `completed` turns are captured.

## Understand the implementation

The consumer participates in `agent/pre-step` only at step one and records a per-session turn gate. It observes `session/event` for `turn/end`, derives the exchange from the append-only log without changing it, and submits capture asynchronously.

## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md)
- [Native MemPalace decision](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.md)

## Model Experience

### Recalled context message

#### What the model sees

The first request in an eligible turn can receive one additional durable user-role message attributed to `memory-context`, containing bounded recalled memories and an instruction-injection warning.

#### Token effect

The message adds recalled text up to `maxRecallBytes` plus the fixed source and untrusted-data wrapper; turns with no results add nothing.

#### KV Cache effect

Recall changes only the request suffix after stable prior history. Later steps do not repeat recall.

## Known Limitations and Deferred Work

- Failed capture is logged and not retried by this consumer; provider queues own accepted work.
- Recall runs once per in-process session/turn even when no result is found.

<a id="dev-note"></a>
### Dev Note

<details><summary>Working context for maintainers — click to expand</summary>

None.

</details>
