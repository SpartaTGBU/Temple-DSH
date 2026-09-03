---
description: "用于本地检查翼区、房间、抽屉、隧道、KG 事实、健康信号和检索透明度可用性的只读 MemPalace 仪表盘投影与认证 Web API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mempalace-dashboard

[English](README.md) | 中文

## 摘要

`dsh-api-mempalace-dashboard` 是一个选择启用的宿主 API，用于检查本地 MemPalace，而不导入或修改 MemPalace 本身。它用只读句柄读取 MemPalace 配置、抽屉 SQLite 元数据、`tunnels.json` 与 `knowledge_graph.sqlite3`，并为 Web 客户端返回一个规范化快照。缺失的检索 trace、维护健康扫描或不支持的后端会作为明确的不可用状态返回。

## 使用本包

把本包挂载在 Web 宿主平面，并启用配套客户端包。Web bundle 随附的两个 row 默认禁用；profile 或 patch layer 通过启用 `mempalace-dashboard` 与 `ui-mempalace-dashboard` 来选择开启。

API 在 `/api` 下注册一个已认证的共享通道 endpoint：`mempalaceDashboard/inspect`。它接受可选的 `wing`、`room`、`query` 与 `limit` 字段。空字符串会被忽略，`limit` 会限制在 1..100。`palacePath` 与 `configPath` 可在 row 中配置；未配置时，adapter 遵循 MemPalace 的本地配置与环境变量约定。

## 生命周期与安全边界

插件不执行写入，并用 `readOnly` 与 `PRAGMA query_only` 打开 SQLite 数据库。它不调用 MemPalace CLI，也不导入已检出的 MemPalace 源码树。endpoint 只会在组合后的 Connection 服务应用常规 Host/Origin 检查与浏览器认证之后可用。由于记忆内容敏感，Web bundle 默认禁用该 row，直到部署显式选择启用。

## 已知限制与延期工作

- **后端** — 投影读取本地 `chroma` 与 `sqlite_exact` SQLite 布局。Qdrant、Milvus、pgvector 与仅存在于实时 Hub 的状态会报告 `unsupported-backend`，不会伪造局部 palace。
- **检索透明度** — 上游 MemPalace search 会返回候选项和分数，但被检查的文件不持久化某次 DSH 回答由哪些抽屉、KG 事实、被过滤候选项或模型上下文文本影响。API 在持久 trace 来源存在前返回 `retrieval-traces-not-persisted`。
- **健康** — 抽屉、翼区、房间与 KG 计数来自文件，可被证明。重复、陈旧记忆、矛盾与孤儿扫描是维护操作，没有持久结果文件，因此返回 `memory-health-not-persisted`。

## 模型体验

无。本包只注册宿主检查 API，不向 prompt、tool 或模型可见上下文贡献内容。

#### KV Cache effect

无；本包不组装或发送 provider request。
