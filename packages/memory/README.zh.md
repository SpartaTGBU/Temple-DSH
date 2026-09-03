---
description: "自动长期记忆的包映射：与提供方无关的服务、生命周期消费者和原生 MemPalace 后端。"
kind: "package-group"
---

# memory/ — 自动长期记忆

[English](README.md) | 中文

## 概述

`memory/` 组让 Temple-DSH 无需模型工具调用即可自动长期召回、捕获已完成轮次并执行 host 图探索。提供方无关服务使 agent 和 Dashboard 消费者独立于存储；MemPalace 提供方在一个受管 Python sidecar 中运行直接 MemPalace API。该能力为可选启用，且不使用 MCP。

## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | 提供方无关的召回、捕获、有界图、状态与 flush 约定 | `ctx.memory` |
| [`memory-context/`](memory-context/README.zh.md) | 自动首次 step 召回和已完成轮次捕获 | 消费 `ctx.memory` |
| [`memory-mempalace/`](memory-mempalace/README.zh.md) | 持久原生 MemPalace 提供方 | 提供 `ctx.memory` |

## 相关文档

- [记忆子系统](../../docs/subsystems/memory.zh.md) — 生命周期和服务约定。
- [原生 MemPalace 决策](../../.agents/notes/implemented/feature/2026-09-02-native-mempalace-memory.zh.md)——能力边界与安全选择。
- [由提供方拥有的 palace 图决策](../../.agents/notes/implemented/feature/2026-09-02-mempalace-multipass-graph-seam.zh.md)——有界 host 获取和预期 Dashboard seam。

## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
