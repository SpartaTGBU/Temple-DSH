---
description: "用于 Temple-DSH 自动记忆的持久直接 API MemPalace 提供方，带受管 JSONL 进程生命周期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-mempalace

[English](README.md) | 中文

## 概述

`dsh-memory-mempalace` 通过直接 MemPalace Python API 提供 `ctx.memory`。一个惰性启动的持久 worker 通过私有有界 JSONL 协议处理召回、捕获和有界图请求。它不是 MCP 服务器，也不注册面向模型的工具。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

把 MemPalace 安装到配置的 Python 环境中，在 `dsh-memory-context` 之前挂载此提供方，并显式启用二者。基础 profile 支持 `MEMPALACE_ENABLED=1`、`MEMPALACE_PYTHON`、`MEMPALACE_PALACE_PATH`、`MEMPALACE_COLLECTION`、`MEMPALACE_BACKEND` 和 `MEMPALACE_WING`。独立示例是 [`mempalace-native.cordis.yml`](../../../apps/cli/config/examples/memory/mempalace-native.cordis.yml)。

提供方维护有界捕获队列，在超时或协议输出格式错误/超大后重启 worker，在 TypeScript 边界再次应用召回和图上限，并在 flush 与销毁时排空已接受捕获工作。图调用方在配置的 `maxGraphNodes`、`maxGraphEdges`、`maxGraphHops` 和 `maxGraphBytes` 内选择上限；`maxGraphScanRecords` 限制后端 metadata 读取。子进程 stderr 和凭据不会进入结果或模型可见错误。

<a id="understand-the-implementation"></a>
## 理解实现

TypeScript 提供方以 argv 数组和管道 stdio 使用 `ctx.subprocess`。[`resources/bridge.py`](resources/bridge.py) 直接导入 MemPalace，复用一个后端 collection，调用 `search_memories` 召回，调用 `file_conversation_exchange` 捕获，并为图探索分页读取有界 collection metadata。它不调用无界 `build_graph()`、读取调用方选择的文件、执行调用方代码或启动第二项服务。

<a id="further-exploration"></a>
## 延伸阅读

- [记忆子系统](../../../docs/subsystems/memory.zh.md)
- [原生 MemPalace 决策](../../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.zh.md)
- [由提供方拥有的 palace 图决策](../../../.agents/notes/implemented/feature/2026-09-02-mempalace-multipass-graph-seam.zh.md)

<a id="model-experience"></a>
## 模型体验

通过 `dsh-memory-context` 间接生效；此提供方自身没有工具或提示词。

#### KV Cache 影响

无直接影响。消费者拥有请求上下文插入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延后工作

- MemPalace 及其 embedding/后端依赖仍是外部 Python 依赖。
- 首次 Chroma 操作可能初始化或下载 embedding 模型，因此会比稳态请求耗时更长。
- 捕获队列溢出时会明确拒绝新工作，而不是丢弃旧的已接受轮次。

<a id="dev-note"></a>
### 开发备注

<details><summary>维护者工作上下文——点击展开</summary>

无。

</details>
