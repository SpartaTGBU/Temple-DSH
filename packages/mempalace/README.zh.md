---
description: "MemPalace 包组：消费 MemPalace 自有 palace graph 导出的可选图探索适配器。"
kind: "package-group"
---

# packages/mempalace

[English](README.md) | 中文

## 概述

MemPalace 组包含消费 MemPalace 自有导出、但不成为 DSH memory provider 的可选包。当前包读取 `palace_graph.build_graph()` JSON，并注册面向模型的图探索工具。MemPalace 仍负责 mining、persistence、drawer recall 和 traversal helpers；DSH 只拥有 host 侧工具约定、验证和归一化结果 DTO。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-mempalace-multipass`](tool-mempalace-multipass/README.zh.md) | 归一化 MemPalace build_graph 兼容 JSON，并暴露有界多跳 room 探索 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [能力 seam](../../docs/architecture.zh.md)——为什么此包是可选工具，而不是 loop patch 或存储提供方。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mempalace-multipass)——模型接收的 `mempalace_multipass_explore` schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-tool-mempalace-multipass)——每个受支持配置字段。
- [MemPalace multipass graph seam Agent Note](../../.agents/notes/implemented/feature/2026-09-02-mempalace-multipass-graph-seam.zh.md)——集成决策及其备选方案。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

当前包只是基于外部 JSON 导出的单个可选工具，不是完整 DSH 子系统，因此还没有子系统页面拥有此组。

</details>
