---
description: "用于自动召回、已完成轮次捕获、健康状态和排空的提供方无关 ctx.memory 约定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 定义 `ctx.memory`，即生命周期消费者使用的可替换长期记忆服务。它自身不存储数据，也不公开面向模型的工具。提供方实现有界召回、异步已完成轮次捕获、非敏感状态以及可等待的 flush。

## 使用此包

消费者以查询、条目上限和字节上限调用 `recall`；以一组完整用户/助手交换调用 `captureTurn`；并在拆卸前或需要确认持久完成时调用 `flush`。提供方必须保留召回取消语义，并且不得通过状态暴露凭据或原始后端诊断。

## 理解实现

抽象 `MemoryRuntime` 注册为 `ctx.memory`。请求和结果对象只携带提供方无关字段，因此消费者无需导入 MemPalace。

## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [记忆包映射](../README.zh.md)

## 模型体验

间接。生命周期消费者注入召回上下文；此服务本身不贡献提示词、消息、schema 或工具。

#### KV Cache 影响

消费者的首次 step 召回会在稳定会话历史之后追加可变上下文，因此改变该请求的后缀。

## 已知限制和延后工作

- 一个组合挂载一个记忆提供方，因为 `ctx.memory` 是单项服务。
- 此约定不定义记忆管理 UI 或模型工具。

## 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>
