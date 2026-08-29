---
description: "Host memory-pressure detection: sample process heap-used against watermarks and publish level transitions on runtime/memory-pressure so shedding responders (compaction, session residency, spill, caches) react to one signal."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-pressure

[English](README.md) | 中文

## 概述

`dsh-memory-pressure` 为一个组合提供关于宿主内存压力的单一共享信号。它按间隔采样进程 heap-used 字节，将读数按 elevated 与 critical 两个水位分类，并在每次级别跃迁时发出 `runtime/memory-pressure`——因此稳态不产生流量，而每次跃迁都携带触发它的读数。它只负责检测：诸如压实、会话驻留接缝、溢出策略与有界缓存等内存卸载响应者消费这唯一事件，并各自决定卸载多少，因此众多独立反应共乘一个检测器。当部署应对宿主内存压力做出反应而不仅是对每请求令牌压力做出反应时挂载它。它注册 `ctx.memoryPressure` 以便直接读取级别与强制采样；它自身从不卸载任何东西。

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

挂载该插件以发布宿主内存压力，然后在插件应在负载下卸载的任何地方消费该事件。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-memory-pressure'
  config:
    elevatedBytes: 1073741824
    criticalBytes: 1610612736
    intervalMs: 5000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `elevatedBytes` | `1073741824`（1 GiB） | heap-used 字节数达到或超过此值时压力为 `elevated`。 |
| `criticalBytes` | `1610612736`（1.5 GiB） | heap-used 字节数达到或超过此值时压力为 `critical`。必须大于 `elevatedBytes`。 |
| `intervalMs` | `5000` | 采样间隔（毫秒）。 |

不大于 `elevatedBytes` 的 `criticalBytes` 会在构造时、服务注册之前拒绝该插件。

### 消费该信号

```ts
import type { MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'

declare const ctx: import('@deepseek-ai/cordis').Context

ctx.on('runtime/memory-pressure', (sample: MemoryPressureSample) => {
  if (sample.level === 'critical') {
    // shed aggressively: flush caches, evict idle sessions
  }
})
```

该事件只在跃迁时触发。用 `ctx.memoryPressure.level` 直接读取当前级别，或用 `ctx.memoryPressure.sample()` 强制一次即时读数（当级别改变时它也会发布一次跃迁）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

该插件建立在一个边界上：检测并通告，绝不卸载。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `MemoryPressure` 服务、`runtime/memory-pressure` 事件声明、`classifyPressure`、水位默认值 |
| [`src/types.ts`](src/types.ts) | `MemoryPressureLevel`、`MemoryPressureSample`、`MemoryPressureConfig` |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随（无运行时不变量；分类由单元测试覆盖） |

### 采样与跃迁

该服务在 `ctx.effect` 内启动一个间隔定时器，因此采样器随插件一并释放，且定时器被 `unref`，使得仅采样绝不使进程存活。每次采样读取 heap-used，用 `classifyPressure`（下界包含）分类，并仅在级别不同于所保留的当前级别时发出。读取器可注入，因此测试无需触及真实进程内存即可驱动确定读数。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [内存计量器](../../util/memory-meter/README.zh.md) — 响应者与该信号配对以挑选驱逐候选者所用的每会话计量。
- [会话子系统](../../../docs/subsystems/session.zh.md) — 驻留响应者从中卸载的内存存储。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该宿主内存压力检测器采样进程内存，不注册任何提示、消息、工具或模式。

#### KV 缓存影响

无直接失效；它观察宿主内存，绝不改动请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该插件刻意不做的事。它们是当前的包约束，而非任务待办。

- **仅检测** — 它发布级别但从不卸载；除非有响应者消费该事件，否则部署得不到缓解。
- **Heap-used 而非 RSS** — 它分类 `heapUsedBytes`，后者跟踪 JS 对象图但不含原生或外部缓冲；以堆外内存为主的负载需要不同的读取器。
- **间隔采样** — 两次采样间的尖峰只在下一个 tick 被看到；间隔以检测延迟换取采样成本。
- **全局水位** — 一对 elevated/critical 全进程适用；它不将压力归因于某个会话，也不按工作区划分预算。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
