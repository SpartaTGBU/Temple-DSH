---
description: "用于召回、捕获、有界图探索、健康状态和排空的提供方无关 ctx.memory 约定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 定义 `ctx.memory`，即生命周期和 host 消费者使用的可替换长期记忆服务。它自身不存储数据，也不公开面向模型的工具。提供方实现有界召回、异步已完成轮次捕获、有界且与 renderer 无关的图探索、非敏感状态以及可等待的 flush。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

消费者以查询、条目上限和字节上限调用 `recall`；以严格的节点、边、跳数和序列化字节上限调用 `exploreGraph`；以一组完整用户/助手交换调用 `captureTurn`；并在拆卸前或需要确认持久完成时调用 `flush`。提供方保留取消语义，且图请求绝不接受图数据、本地路径、命令或可执行文件。

<a id="understand-the-implementation"></a>
## 理解实现

抽象 `MemoryRuntime` 注册为 `ctx.memory`。请求和结果对象只携带提供方无关字段，因此消费者无需导入 MemPalace。

<a id="further-exploration"></a>
## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [记忆包映射](../README.zh.md)

<a id="model-experience"></a>
## 模型体验

通过注入召回上下文的生命周期消费者间接生效；此服务本身不贡献提示词、消息、schema 或工具。

#### KV Cache 影响

消费者的首次 step 召回会在稳定会话历史之后追加可变上下文，因此改变该请求的后缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延后工作

- 一个组合挂载一个记忆提供方，因为 `ctx.memory` 是单项服务。
- 此约定不定义记忆管理 UI 或模型工具。

<a id="dev-note"></a>
### 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>
