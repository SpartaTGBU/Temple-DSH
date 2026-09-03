---
description: "用于自动召回、已完成轮次捕获、健康状态和排空的提供方无关 ctx.memory 约定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 定义 `ctx.memory`，即生命周期消费者使用的可替换长期记忆服务。它自身不存储数据，也不公开面向模型的工具。提供方实现有界召回、异步已完成轮次捕获、非敏感状态以及可等待的 flush。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制和延后工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

消费者以查询、条目上限和字节上限调用 `recall`；以一组完整用户/助手交换调用 `captureTurn`；并在拆卸前或需要确认持久完成时调用 `flush`。提供方必须保留召回取消语义，并且不得通过状态暴露凭据或原始后端诊断。

<a id="understand-the-implementation"></a>
## 理解实现

抽象 `MemoryRuntime` 注册为 `ctx.memory`。请求和结果对象只携带提供方无关字段，因此消费者无需导入 MemPalace。

<a id="further-exploration"></a>
## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [记忆包映射](../README.zh.md)

<a id="dev-note"></a>
## 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

### 服务定义

#### 模型看到什么

没有直接内容。`ctx.memory` 是提供方无关的运行时约定；生命周期消费者拥有任何召回消息。

#### Token 影响

没有直接 token。实现向消费者返回有界数据，而不自行添加模型上下文。

#### KV Cache 影响

没有直接影响。消费者可以在稳定会话历史之后追加可变召回，从而改变该请求后缀。

## 已知限制和延后工作

<a id="known-limitations-and-deferred-work"></a>

- 一个组合挂载一个记忆提供方，因为 `ctx.memory` 是单项服务。
- 此约定不定义记忆管理 UI 或模型工具。
