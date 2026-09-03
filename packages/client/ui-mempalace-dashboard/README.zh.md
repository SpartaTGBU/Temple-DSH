---
description: "可选的 MemPalace 仪表盘设置分区，用于渲染已认证的宿主投影：翼区、房间、抽屉、隧道、KG 时间线事实、健康信号与检索透明度状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mempalace-dashboard

[English](README.md) | 中文

## 摘要

`dsh-client-ui-mempalace-dashboard` 为 Web 客户端贡献一个可选的设置分区，用于检查 MemPalace。它调用 `dsh-api-mempalace-dashboard` 宿主 endpoint，渲染规范化结构与 KG 投影，并对 MemPalace 未持久化的数据显示不可用状态。

## 使用本包

在 Web profile 中把这个浏览器 row 与宿主 API row 一起启用。该分区在 Settings 中显示为 **MemPalace**，并提供翼区、房间和抽屉文本过滤。刷新会读取当前宿主快照；页面卸载后组件不保留记忆数据副本。

## 生命周期与安全边界

浏览器包没有文件系统访问能力。它只通过已认证的 Connection RPC endpoint 读取，因此 Host/Origin 检查与浏览器 token 交换由现有传输层拥有。产品文案通过 `mempalaceDashboard` locale namespace 注册；分区通过 `settings.section` 注册，所以设置外壳 teardown 会干净移除它。

## 已知限制与延期工作

- **只读视图** — 面板有意不执行编辑；纠正、删除与修复流程在经过审查的维护 API 出现前仍留在 MemPalace 工具中。
- **没有回答 trace 下钻** — 面板渲染 API 的明确检索 trace 不可用状态，因为没有可检查的持久逐回答 trace。
- **没有图形画布** — 第一片是可审查的检查面板和类型化 API。图形或时间线可视化可以以后消费同一投影。

## 模型体验

无。本包只注册浏览器设置分区，不贡献模型可见内容。

#### KV Cache effect

无；本包不组装或发送 provider request。
