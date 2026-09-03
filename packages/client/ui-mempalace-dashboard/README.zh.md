---
description: "可选的 MemPalace 仪表盘设置分区，用于渲染已认证的宿主投影：翼区、房间、抽屉、隧道、KG 时间线事实、健康信号与检索透明度状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mempalace-dashboard

[English](README.md) | 中文

## 概述

`dsh-client-ui-mempalace-dashboard` 为 Web 客户端贡献一个可选的设置分区，用于检查 MemPalace。它调用 `dsh-api-mempalace-dashboard` 宿主 endpoint，渲染规范化结构与 KG 投影，并对 MemPalace 未持久化的数据显示不可用状态。

## 目录

- [使用本包](#use-this-package)
- [生命周期与安全边界](#lifecycle-and-security-boundaries)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

设置 `MEMPALACE_ENABLED=1`，即可把这个浏览器 row 与原生提供方、自动记忆消费者和宿主 API 一起启用。该分区在 Settings 中显示为 **MemPalace**，并提供翼区、房间和抽屉文本过滤。编辑过滤条件不会发出请求；首次挂载和显式刷新各读取一次当前宿主快照，刷新后或卸载后的过期完成结果会被忽略。

-----

<a id="lifecycle-and-security-boundaries"></a>
## 生命周期与安全边界

浏览器包没有文件系统访问能力。它只通过已认证的 Connection RPC endpoint 读取，因此 Host/Origin 检查与浏览器 token 交换由现有传输层拥有。产品文案通过 `mempalaceDashboard` locale namespace 注册；分区通过 `settings.section` 注册，所以设置外壳 teardown 会干净移除它。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只注册浏览器设置分区，不贡献模型可见内容。

#### KV Cache effect

无；本包不组装或发送 provider request。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只读视图** — 面板有意不执行编辑；纠正、删除与修复流程在经过审查的维护 API 出现前仍留在 MemPalace 工具中。
- **没有回答 trace 下钻** — 面板渲染 API 的明确检索 trace 不可用状态，因为没有可检查的持久逐回答 trace。
- **没有图形画布** — 第一片是可审查的检查面板和类型化 API。图形或时间线可视化可以以后消费同一投影。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
