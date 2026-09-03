---
description: "用于 Temple-DSH 自动记忆的持久直接 API MemPalace 提供方，带受管 JSONL 进程生命周期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-mempalace

[English](README.md) | 中文

## 概述

`dsh-memory-mempalace` 通过直接 MemPalace Python API 提供 `ctx.memory`。一个惰性启动的持久 worker 通过私有有界 JSONL 协议处理召回与捕获请求。它不是 MCP 服务器，也不注册面向模型的工具。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制和延后工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

把 MemPalace 安装到配置的 Python 环境中，在 `dsh-memory-context` 之前挂载此提供方，并显式启用二者。基础 profile 支持 `MEMPALACE_ENABLED=1`、`MEMPALACE_PYTHON`、`MEMPALACE_PALACE_PATH`、`MEMPALACE_COLLECTION`、`MEMPALACE_BACKEND` 和 `MEMPALACE_WING`。独立示例是 [`mempalace-native.cordis.yml`](../../../apps/cli/config/examples/memory/mempalace-native.cordis.yml)。

提供方维护有界捕获队列，在超时或协议输出格式错误后重启 worker，在 TypeScript 边界再次应用召回和结果上限，并在 flush 与销毁时排空已接受捕获工作。子进程 stderr 和凭据不会进入召回结果或模型可见错误。

<a id="understand-the-implementation"></a>
## 理解实现

TypeScript 提供方以 argv 数组和管道 stdio 使用 `ctx.subprocess`。[`resources/bridge.py`](resources/bridge.py) 直接导入 MemPalace，复用一个后端 collection，调用 `search_memories` 召回，并调用 `file_conversation_exchange` 把捕获写入配置 wing 的 `conversations` room。

<a id="further-exploration"></a>
## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [原生 MemPalace 决策](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.zh.md)

<a id="dev-note"></a>
## 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

### 提供方行为

#### 模型看到什么

没有直接内容。`dsh-memory-context` 决定有界 MemPalace 召回是否进入请求；此提供方自身没有工具或提示词。

#### Token 影响

没有直接 token。召回文本由数据决定，并在消费者收到前于 TypeScript 提供方边界再次受限。

#### KV Cache 影响

无直接影响。消费者拥有请求上下文插入。

## 已知限制和延后工作

<a id="known-limitations-and-deferred-work"></a>

- MemPalace 及其 embedding/后端依赖仍是外部 Python 依赖。
- 首次 Chroma 操作可能初始化或下载 embedding 模型，因此会比稳态请求耗时更长。
- 捕获队列溢出时会明确拒绝新工作，而不是丢弃旧的已接受轮次。
