---
description: "Session residency policy: under host memory pressure, rank resident sessions with the memory meter and select idle, closed-turn eviction candidates for a swappable residency executor, so cold sessions can leave the heap without losing modularity."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-residency

[English](README.md) | 中文

## 概述

`dsh-session-residency` 决定当宿主处于内存压力时哪些空闲会话应离开堆。它消费 `runtime/memory-pressure` 信号与每会话内存计量器，对某个存储列出的会话排序，然后选择驱逐候选者——同时绝不选择带有打开回合的会话或在空闲窗口内活动过的会话。它只负责决策：机械的丢弃与再水合被委托给部署所注册的 `ResidencyExecutor`，因此该策略保持纯粹且可替换，而会话存储主干不受触动。在未注册执行器时它只报告候选者而不驱逐，因此组合可在选择加入前先测量该策略。当长时间运行的宿主应卸载冷会话而非在整个生命周期内保持每个会话常驻时挂载它（连同 `dsh-memory-meter` 与 `dsh-memory-pressure`）。

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

挂载该插件，注册真正执行驱逐的执行器，并将内存压力事件接到对会话存储的一次遍历上。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-session-residency'
  config:
    idleMs: 300000
    minLevel: elevated
    maxEvictionsPerPass: 8
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `idleMs` | `300000`（5 分钟） | 会话在可被驱逐前必须空闲的毫秒数。 |
| `minLevel` | `elevated` | 达到或超过此压力级别时运行一次驱逐遍历。 |
| `maxEvictionsPerPass` | `8` | 一次遍历中驱逐的最大会话数。 |

### 注册执行器并对压力做出反应

```ts
import type {} from '@deepseek-ai/dsh-session-residency'
import type { EvictionCandidate } from '@deepseek-ai/dsh-session-residency'
import type { MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListing } from '@deepseek-ai/dsh-memory-meter'

declare const ctx: Context
declare const store: SessionListing
declare const lastActiveAt: (id: unknown) => number | undefined

ctx.sessionResidency.registerExecutor({
  async evict(candidate: EvictionCandidate) {
    // persist and drop the session's resident state so it rehydrates on next access
  },
})

ctx.on('runtime/memory-pressure', (sample: MemoryPressureSample) => {
  void ctx.sessionResidency.onPressure(sample, store, lastActiveAt)
})
```

`onPressure` 仅在级别达到下限时运行一次遍历。`plan(store, lastActiveAt)` 返回排序后的候选者而不采取行动，`runPass(...)` 则规划并通过所注册的执行器驱逐。由于 `deriveMessages()` 是从持久日志的纯再推导，被执行器丢弃并从持久化再水合的会话逐字节相同。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

该包建立在一个边界上：从公开表面决策，委托丢弃。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SessionResidency` 服务、`hasOpenTurn`、`shouldRun`、`plan`、`runPass`、`onPressure`、默认值 |
| [`src/types.ts`](src/types.ts) | `EvictionCandidate`、`EvictionPlan`、`ResidencyExecutor`、`ResidencyConfig` |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随（无运行时不变量；规划由单元测试覆盖） |

### 为何该策略从不直接驱逐

存储将会话的生命周期绑定到其所属 Cordis fiber；安全地丢弃常驻状态是主干关注点。将驱逐置于所注册的 `ResidencyExecutor` 之后，意味着该策略是存储公开 `list()`、内存计量器与一个 last-active 访问器的纯函数——无需真实存储即可测试且可按部署替换。`hasOpenTurn` 读取公开事件日志（最后的回合边界），使打开的回合绝不成为候选者，从而无需私有会话访问即满足协作式驱逐要求。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [内存计量器](../../util/memory-meter/README.zh.md) — 该策略据以排序的每会话计量。
- [内存压力](../../runtime-diagnostics/memory-pressure/README.zh.md) — 触发驱逐遍历的信号。
- [会话持久化](../session-persistence/README.zh.md) — 执行器用来持久化并再水合被丢弃会话的接缝。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该宿主驻留策略决定会话驱逐，不注册任何提示、消息、工具或模式。

#### KV 缓存影响

无直接失效；再水合的会话会再推导出相同的日志，因此被复用的请求前缀不变。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该包刻意不做的事。它们是当前的包约束，而非任务待办。

- **仅决策** — 它选择候选者并调用执行器；无执行器时组合只得到排序而无缓解。机械的存储丢弃与再水合是执行器的职责。
- **last-active 由外部提供** — 该策略自身不跟踪活动；组合传入 `lastActiveAt` 访问器，因此空闲精度仅取决于该来源。
- **按序列化字节排序** — 驱逐顺序使用内存计量器的估算而非精确保留大小；对象形态异常的负载可能排序不完美。
- **每次触发一遍** — 一次遍历将驱逐上限设为 `maxEvictionsPerPass`；持续压力依赖重复的跃迁而非一次扫清每个空闲会话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

执行实际常驻状态丢弃与持久化再水合的随附执行器，计划在存储暴露主干级驱逐钩子后作为后续包提供；本策略是解锁它的决策一半。

</details>
