---
description: "Temple-DSH agent 的自动首次 step 长期记忆召回和恰好一次已完成轮次捕获。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

[English](README.md) | 中文

## 概述

`dsh-memory-context` 让 `ctx.memory` 无缝工作：轮次的第一个合格 step 自动召回相关背景，成功完成的轮次恰好一次进入捕获队列。模型从不调用记忆工具。召回失败会退化为原始请求，而捕获在模型路径之外运行。

## 使用此包

在一个 `ctx.memory` 提供方之后挂载。`recallLimit`、`maxRecallBytes` 和 `recallTimeoutMs` 限制延迟与上下文。`captureSubagents` 默认为 false，避免委派或合成会话污染用户记忆。

召回文本以 `memory-context` 标注来源，并以明确的不可信数据警告开头。只有直接用户文本构成召回查询与捕获输入；插件消息、推理块、工具和图片都被排除。只有 `completed` 轮次会被捕获。

## 理解实现

消费者只在 step 一参与 `agent/pre-step`，并记录每会话轮次闸门。它观察 `session/event` 的 `turn/end`，从只追加日志中派生交换而不修改日志，并异步提交捕获。

## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [原生 MemPalace 决策](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.zh.md)

## 模型体验

合格轮次的首次请求可以收到一条额外持久用户角色上下文消息，其中包含有界召回记忆和指令注入警告。

#### KV Cache 影响

召回只改变稳定既有历史之后的请求后缀。后续 step 不会重复召回。

## 已知限制和延后工作

- 捕获失败会记录日志但消费者不重试；提供方队列拥有已接受工作。
- 即使找不到结果，每个进程内会话/轮次也只运行一次召回。

## 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>
