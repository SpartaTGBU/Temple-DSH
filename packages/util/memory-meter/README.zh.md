---
description: "Zero-dependency retained-byte accounting for in-memory sessions: estimate a session's approximate heap cost from its public event log and rank sessions for eviction, telemetry, and memory benchmarks."
kind: "package-library"
---

# @deepseek-ai/dsh-memory-meter

[English](README.md) | 中文

## 概述

`dsh-memory-meter` 让任何插件都能测量一个会话占用了多少堆内存，而无需触及会话的私有内部结构。它从会话的公开事件日志估算其近似保留字节——序列化内容字节加上固定的每事件对象开销——并按成本对会话排序，使驱逐策略或遥测面可以先处理成本最高者。该估算是稳定、廉价、随日志规模单调的启发式，这正是内存压力响应者所需；它不是精确的堆测量。该库零依赖，只读取会话已暴露的 `events` 数组，因此与 session 包的实现保持解耦。将其与随附的宿主基准配对，即可在改变会话保留内容时获得真实的前后 RSS 数字。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用 `estimateSessionMemory` 计量单个会话，用 `reportSessionMemory` 对某个存储列出的每个会话排序。两者都只读取公开的 `events` 表面，因此从不依赖会话的私有字段。

### 计量单个会话

```ts
import { estimateSessionMemory } from '@deepseek-ai/dsh-memory-meter'

declare const session: { readonly events: readonly unknown[] }

const estimate = estimateSessionMemory(session)
// estimate.retainedBytes = contentBytes + count * EVENT_OBJECT_OVERHEAD_BYTES
```

`contentBytes` 是每个事件 JSON 序列化后的 UTF-8 长度之和；`overheadBytes` 收取固定的每事件对象成本。无法序列化的事件（存在环）贡献零内容字节，但仍计入其开销，因此估算对活动日志从不抛错。

### 对存储的会话排序

```ts
import { reportSessionMemory } from '@deepseek-ai/dsh-memory-meter'

declare const store: { list(): readonly { readonly id: unknown; readonly events: readonly unknown[] }[] }

const report = reportSessionMemory(store)
// report.sessions is sorted by descending retainedBytes — the eviction candidates first
// report.totalRetainedBytes is the aggregate across every listed session
```

`reportSessionMemory` 接受任何带有返回承载事件单元的 `list()` 的对象，因此 dsh 的 `SessionStore`（`ctx.sessions`）可直接适配。成本最高的会话是 `report.sessions[0]`。

### 测量可回收的分块字节

```ts
import { estimateChunkReclaim, reportChunkReclaim } from '@deepseek-ai/dsh-memory-meter/chunk-reclaim'

declare const session: { readonly events: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }

const est = estimateChunkReclaim(session.events)
// est.reclaimableBytes = residentBytes - packedBytes, the heap a chunk-run pack would free
```

流式 `assistant/chunk` 运行主导着已完成会话的常驻字节。`estimateChunkReclaim` 报告用随附的分块行编解码器打包这些运行可回收多少——一次在只读副本上的纯粹、非变异测量。`reportChunkReclaim(store)` 按可回收分块字节降序对每个列出的会话排序。该入口需要 `@deepseek-ai/dsh-session`；基础模块保持零依赖。

### 测量用于分层的冷日志

```ts
import { estimateLogTiering, reportLogTiering } from '@deepseek-ai/dsh-memory-meter/log-tiering'

declare const session: { readonly events: readonly unknown[]; readonly surface: { readonly nodes: readonly number[] } }

const est = estimateLogTiering(session)
// est.coldBytes is the resident prefix below the derivation surface — pageable to persistence
```

`deriveMessages()` 只遍历表层节点，因此最低表层节点以下的每个事件都是冷的，除非 fork 或导出将其换回，否则绝不重新推导。`estimateLogTiering` 将会话的常驻日志拆分为该冷前缀（可回收）与热尾（须保持常驻），只读取公开的事件与表层。`reportLogTiering(store)` 按冷字节降序对会话排序。该入口与基础模块一样零依赖。

### 运行宿主内存基准

```text
node --expose-gc --import tsx/esm packages/util/memory-meter/tests/host-memory.perf.ts
```

该基准构建 `BENCH_SESSIONS`（默认 200）个各含 `BENCH_EVENTS`（默认 400）个事件的会话，并在计量器估算旁打印真实 RSS/堆增量，因此对会话保留的改动都有具体的前后数字。见 [MEMORY-BENCHMARK.md](MEMORY-BENCHMARK.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

该库建立在一个边界上：从公开日志估算，绝不从会话私有状态估算。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `estimateEvents`、`estimateSessionMemory`、`reportSessionMemory`、`contentBytesOf`、`utf8ByteLength`、`EVENT_OBJECT_OVERHEAD_BYTES` |
| [`src/chunk-reclaim.ts`](src/chunk-reclaim.ts) | `estimateChunkReclaim`、`reportChunkReclaim`、`countChunkEvents`（可选 `./chunk-reclaim` 入口；需要 `dsh-session`） |

| [`src/log-tiering.ts`](src/log-tiering.ts) | `estimateLogTiering`、`reportLogTiering`、`coldBoundaryOf`（可选 `./log-tiering` 入口；零依赖） |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随（无运行时不变量；计量代数由单元测试覆盖） |
| [`tests/host-memory.perf.ts`](tests/host-memory.perf.ts) | 可运行的宿主基准，将估算与真实 RSS/堆对比 |

### 为何是启发式而非精确堆遍历

精确的每对象保留大小遍历代价高且在 V8 版本间不稳定。序列化字节加开销的启发式为 O(日志规模)、确定且单调——增长的会话总是成本更高——这正是驱逐排序唯一真正需要的性质。宿主基准记录真实的堆对估算比，使部署方可按自身负载校准字节预算。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当你需要该计量背后的设计背景时阅读这些。

- [会话子系统](../../../docs/subsystems/session.zh.md) — 本库所测量的内存存储与事件日志。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该宿主内存计量库测量会话状态，不注册任何提示、消息、工具或模式。

#### KV 缓存影响

无直接失效；它读取会话状态，绝不改动请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该库刻意不做的事。它们是当前的包约束，而非任务待办。

- **估算而非测量** — 保留字节数是序列化内容启发式加固定开销，而非精确的 V8 保留大小；用宿主基准的堆比校准以获得真实预算。
- **只读公开日志** — 它看不到会话同样持有的派生缓存、快照或提供方缓冲；它计量事件日志，后者占主导但并非全部足迹。
- **按需序列化成本** — `contentBytesOf` 序列化每个事件，因此对极多大型会话做报告并非免费；调用方在热路径排序时应采样或缓存。
- **无驱逐或压力逻辑** — 本包只测量与排序；何时卸载与如何处理的决定存在于内存压力与驻留接缝（Gap B 与 A）中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
