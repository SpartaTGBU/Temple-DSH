---
description: "Cache-release residency executor: when the residency policy selects a session under memory pressure, drop its volatile derived caches (events snapshot, derived messages, request-context fold) while the durable log stays resident and rebuilds lazily."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-residency-cache-release

[English](README.md) | 中文

## 概述

`dsh-session-residency-cache-release` 是会话驱逐的机械一半：当驻留策略在内存压力下选中某个会话时，它回收该会话的易失堆。作为该策略的 `ResidencyExecutor` 注册，它对每个被选中的会话调用 `Session.releaseCaches()`，丢弃事件快照、派生消息投影与请求上下文折叠。持久事件日志绝不被触动，且每个被丢弃的缓存都会在其下一个访问器上从该日志惰性重建，因此被释放的会话在可观测上完全相同——相同的派生消息、相同的事件、相同的上下文。将其与 `dsh-session-residency`（以及内存计量器与内存压力检测器）一同挂载，即可把驻留决策变成真实、安全的内存回收。它自身不执行任何驱逐；仅在策略递交候选者时才行动。

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

在已具备 `ctx.sessions` 与 `ctx.sessionResidency` 的组合中挂载该插件。它在 apply 时将自身注册为驻留执行器；无需配置。

```yaml
- name: '@deepseek-ai/dsh-memory-meter'
- name: '@deepseek-ai/dsh-memory-pressure'
- name: '@deepseek-ai/dsh-session-residency'
- name: '@deepseek-ai/dsh-session-residency-cache-release'
```

挂载后，选中某个会话的驻留遍历会通过 `ctx.sessions.get` 解析它并调用 `releaseCaches()`。会话已离开存储的候选者是无操作。会话保持存活，其下一次读取会从持久日志重建被丢弃的缓存。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

该插件建立在一个保证上：只释放可从日志重建者。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 注册解析候选者并调用 `Session.releaseCaches()` 的 `ResidencyExecutor` |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随（无运行时不变量；可观测一致性由 session 包的派生缓存测试覆盖） |

### 为何缓存释放是安全的

会话的主要易失成本是三个惰性构建的缓存——冻结的事件快照、派生消息数组与请求上下文折叠——每个都是追加日志的纯函数。`Session.releaseCaches()` 丢弃全部三者并重置其簿记，使下一次 `events`、`deriveMessages()` 或 `requestContext()` 相同地重建。由于持久日志、表层与存储生命周期均未被触动，释放一个存活会话不会改变任何可观测值；它只归还缓存所持的堆。该注册乘 `ctx.effect`，因此插件卸载时执行器干净地注销。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会话驻留](../session-residency/README.zh.md) — 选择候选者并驱动此执行器的决策策略。
- [内存计量器](../../util/memory-meter/README.zh.md) — 为驱逐排序会话的计量。
- [内存压力](../../runtime-diagnostics/memory-pressure/README.zh.md) — 触发遍历的信号。
- [会话子系统](../../../docs/subsystems/session.zh.md) — 此执行器释放的日志与缓存。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该执行器释放宿主侧缓存，不注册任何提示、消息、工具或模式。

#### KV 缓存影响

无直接失效；被释放的会话会再推导出相同的日志，因此被复用的请求前缀不变。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该执行器刻意不做的事。它们是当前的包约束，而非任务待办。

- **缓存释放而非完全丢弃** — 它回收易失缓存而持久日志保持常驻；会话的整个足迹只有在未来的存储级驱逐钩子丢弃日志本身时才离开堆。
- **下次读取的重建成本** — 释放后的第一个访问器会重走日志以重建派生缓存，以一次性重算换取被回收的堆。
- **每个策略一个执行器** — 驻留策略接受单个执行器；挂载第二个执行器插件会在注册时被拒绝。
- **仅在被选中时行动** — 它自身不回收任何东西；若驻留策略未在压力下递交候选者，它绝不运行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

完整的常驻日志丢弃（及从持久化再水合）是自然的后继者，一旦会话存储暴露一个在保持条目可再水合的同时移除日志的主干级驱逐钩子。此执行器是当下回收派生缓存内存的安全、可逆的第一步。

</details>
