---
description: "Graphify 集成包，通过 Harness 工具注册表为工作区图索引和查询提供可选能力。"
kind: "package-group"
---

# Graphify packages

[English](README.md) | 中文

## 概述

Graphify 包通过普通 Harness 插件组合把外部 `graphify` CLI 暴露给代理。这个家族是可选的：已发布的基础 profile 默认不加载它，每个插件都把 Graphify 的 Python 包留在 Harness 运行时之外。模型可见注册归属[工具子系统](../../docs/subsystems/tools.zh.md)。

## 包

| 包 | 角色 |
|---|---|
| [`tool-graphify`](tool-graphify/README.zh.md) | 基于 `ctx.subprocess` 的模型可见 `graphify_index` 和 `graphify_query` 工具 |

## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
