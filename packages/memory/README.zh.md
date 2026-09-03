---
description: "自动长期记忆的包映射：与提供方无关的服务、生命周期消费者和原生 MemPalace 后端。"
kind: "package-group"
---

# memory/ — 自动长期记忆

[English](README.md) | 中文

## 概述

`memory/` 组让 Temple-DSH 无需模型调用工具即可自动召回长期记忆并捕获已完成轮次。与提供方无关的服务把 agent 生命周期策略与存储分离；消费者在轮次首次模型请求前召回，并在成功完成后捕获；MemPalace 提供方在单个受管 Python sidecar 中直接运行 MemPalace API。该能力需要显式启用，并且不使用 MCP。

## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | 与提供方无关的召回、捕获、状态和 flush 约定 | `ctx.memory` |
| [`memory-context/`](memory-context/README.zh.md) | 自动首次 step 召回和已完成轮次捕获 | 消费 `ctx.memory` |
| [`memory-mempalace/`](memory-mempalace/README.zh.md) | 持久原生 MemPalace 提供方 | 提供 `ctx.memory` |

## 相关文档

- [记忆子系统](../../docs/subsystems/memory.zh.md) — 生命周期和服务约定。
- [原生 MemPalace 决策](../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.zh.md) — 能力边界和安全选择。

## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
