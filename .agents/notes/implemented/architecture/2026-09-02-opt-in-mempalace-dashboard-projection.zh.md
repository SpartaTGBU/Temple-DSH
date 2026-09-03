# Agent Note: 选择启用的 MemPalace 仪表盘投影

Status: implemented

[English](2026-09-02-opt-in-mempalace-dashboard-projection.md) | 中文

## Problem

MemPalace 把用户记忆存为翼区、房间、抽屉、隧道、日记派生行和时间知识图谱事实，但 dsh 没有针对该状态的窄检查界面。只做浏览器 mock 会让 Web UI 看起来已集成，却没有可信的数据 API；可写维护界面则会在读取模型经过审查前扩大安全边界。

检索透明度还有独立缺口：MemPalace search 能返回候选和分数，但持久文件不标识某次 dsh 回答受哪些记忆或 KG 事实影响，也不标识进入该模型请求的上下文文本。

## Decision

`@deepseek-ai/dsh-api-mempalace-dashboard` 是只读投影的宿主拥有者。它向 `ctx.memory` 请求由提供方解析的 palace、collection、存储后端与 wing 坐标，然后在有界的一次性 worker 中以只读方式打开本地 `chroma` 或 `sqlite_exact` 抽屉数据库。它投影翼区、房间、抽屉、被动隧道、显式隧道、KG 时间线、计数健康与安全提供方状态视图，并对缺失或降级提供方、不支持的后端、缺失 sidecar、缺失 KG 文件、不可用维护扫描和不存在的检索 trace 返回明确不可用状态。

`@deepseek-ai/dsh-client-ui-mempalace-dashboard` 是浏览器消费者。它注册一个 Settings 分区，调用已认证的共享 `/api` endpoint，并在没有直接文件系统访问权的情况下渲染宿主快照。`MEMPALACE_ENABLED=1` 会同时启用原生提供方、自动消费者、宿主 API 和浏览器 row；所有其他值都会禁用这四个 row。

投影只读文件。SQLite 句柄使用 `readOnly` 与 `PRAGMA query_only`；聚合结果、明细结果和 sidecar 字节数都有上限。原生提供方通过其受管 bridge 解析配置而不打开 collection，存储检查则留在可销毁 worker thread 中。endpoint 仍处在既有 Connection Host/Origin 检查和浏览器认证之后。

## Alternatives considered

**只构建浏览器 mock。** 这能满足布局工作，但会隐藏 MemPalace 数据能否安全规范化的问题，并诱导伪造健康与检索字段。

**调用 MemPalace MCP 或 CLI 工具。** 这会复用上游行为，但会从 Web API 请求执行另一个应用，并可能触发实时后端加载、Hub 转发或 dsh 生命周期之外的写路径副作用。

**在 Web profile 中默认启用。** 本地记忆内容敏感，部分 MemPalace 配置指向 Harness home 之外。选择启用 row 能在用户或部署接受这种暴露前保持默认 Web 界面不变。

**把缺失 trace 表示为空结果。** 空结果意味着已经咨询了 trace 来源且没有记录。正确状态是不可用，因为被检查的 MemPalace 文件不持久化逐回答 trace 记录。

## Verification

`packages/api/mempalace-dashboard/tests/projection.host.spec.ts` 为 `sqlite_exact` 布局、KG 行和 `tunnels.json` 构建真实 SQLite fixture，并覆盖过滤规范化、limit 限制、结构/KG 投影、被动和显式隧道、健康不可用信号、检索 trace 不可用状态、缺失 palace 和不支持后端响应。

`packages/client/ui-mempalace-dashboard/tests/apply.client.spec.tsx` 覆盖客户端服务声明、惰性 endpoint 调用、本地化 Settings 分区注册、延迟 slot 声明和 teardown。

## Consequences

第一片很小但可工作：reviewer 可以检查类型化宿主投影、已认证 API 和选择启用的 Settings 面板，而不接受写操作或生成的记忆断言。同一响应以后可以供图形画布、时间线可视化或抽屉下钻使用。

限制在 API 中明确呈现。检索可追踪性和更深的健康分析需要上游 MemPalace 持久化逐回答 trace 或维护扫描结果，或 dsh 记录新的模型可见检索事件。在该持久来源存在前，消费者渲染不可用状态，而不是从当前抽屉内容推断信任数据。
