---
description: "用于本地检查翼区、房间、抽屉、隧道、KG 事实、健康信号和检索透明度可用性的只读 MemPalace 仪表盘投影与认证 Web API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mempalace-dashboard

[English](README.md) | 中文

## 概述

`dsh-api-mempalace-dashboard` 是一个选择启用的宿主 API，用于检查 `ctx.memory` 选择的 MemPalace。提供方解析自己的 palace、collection、后端和捕获 wing；一次性 worker 用只读句柄读取抽屉 SQLite 元数据、`tunnels.json` 与 `knowledge_graph.sqlite3`，并为 Web 客户端返回规范化快照。缺失提供方、配置解析降级、缺失检索 trace、维护健康扫描或不支持的存储后端都是明确的不可用状态。

## 目录

- [使用本包](#use-this-package)
- [生命周期与安全边界](#lifecycle-and-security-boundaries)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包挂载在 Web 宿主平面，并启用配套客户端包。随附 Web profile 仅在 `MEMPALACE_ENABLED=1` 时同时启用原生提供方、自动消费者、宿主 API 和浏览器 row；未设置和所有其他值都会禁用这四个 row。

API 在 `/api` 下注册一个已认证的共享通道 endpoint：`mempalaceDashboard/inspect`。它接受可选的 `wing`、`room`、`query` 与 `limit` 字段。空字符串会被忽略，过滤字符串限制为 256 个字符，`limit` 会限制在 1..100，聚合行数、投影隧道数和 sidecar 字节数都有上限。`sourceTimeoutMs` 限制提供方解析时间，`projectionTimeoutMs` 限制每个一次性检查 worker，`maxConcurrentProjections` 默认把同时运行的 worker 限制为四个。

-----

<a id="lifecycle-and-security-boundaries"></a>
## 生命周期与安全边界

插件不执行写入，并用 `readOnly` 与 `PRAGMA query_only` 打开 SQLite 数据库。提供方配置解析使用原生提供方的私有受管 bridge，但不打开或创建 collection。阻塞式 SQLite 与 sidecar 读取在 worker thread 中运行；请求取消、超时和 endpoint 销毁都会终止进行中的 worker。存储失败返回固定诊断，不返回原始 SQLite 错误。endpoint 只会在组合后的 Connection 服务应用常规 Host/Origin 检查与浏览器认证之后可用。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只注册宿主检查 API，不向 prompt、tool 或模型可见上下文贡献内容。

#### KV Cache effect

无；本包不组装或发送 provider request。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **后端** — 投影读取本地 `chroma` 与 `sqlite_exact` SQLite 布局。Qdrant、Milvus、pgvector 与仅存在于实时 Hub 的状态会报告 `unsupported-backend`，不会伪造局部 palace。
- **检索透明度** — 上游 MemPalace search 会返回候选项和分数，但被检查的文件不持久化某次 DSH 回答由哪些抽屉、KG 事实、被过滤候选项或模型上下文文本影响。API 在持久 trace 来源存在前返回 `retrieval-traces-not-persisted`。
- **健康** — 抽屉、翼区、房间与 KG 计数来自文件，可被证明。重复、陈旧记忆、矛盾与孤儿扫描是维护操作，没有持久结果文件，因此返回 `memory-health-not-persisted`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
