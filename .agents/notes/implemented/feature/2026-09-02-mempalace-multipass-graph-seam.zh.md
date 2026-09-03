# Agent Note: 由提供方拥有的 palace 图探索

Status: implemented

[English](2026-09-02-mempalace-multipass-graph-seam.md) | 中文

## 问题

Palace 可视化需要来自已配置记忆存储的结构数据，但内联图 JSON 和任意图文件路径会让模型或传输输入取代 palace 成为事实来源。第二个 MemPalace 进程或配置权威也会偏离召回与捕获生命周期。

## 决策

`MemoryRuntime.exploreGraph()` 是与提供方无关的 host 操作。可信 host 消费者只提供节点、边、跳数、结果字节与取消上限，以及可选起始 room；不能提供图数据、路径、Python、命令或后端配置。该操作返回 `dsh.memory.graph.v1`：与 renderer 无关的 room/wing 节点、placement/tunnel/path 边、确定性广度优先访问、截断标记和计数。

`MemPalaceMemory` 通过现有持久 worker 和已配置 collection 实现该操作。Bridge 使用固定扫描上限直接分页读取 collection metadata，而不调用无界的上游 `build_graph()`。它限制名称、扫描记录、节点、边、跳数、输出字节、JSONL 帧字节和请求时间；TypeScript 再次验证每个 worker 字段和完整结果的所有上限。取消或格式错误/超大的协议输出会终止 worker；后续召回、捕获或图操作启动一个替代 worker。

Dashboard 分支可提供一个类型化、经认证的 host endpoint，调用 `ctx.memory.exploreGraph(request, signal)` 并把 DTO 原样转发给 renderer。浏览器代码不会收到 palace 路径、collection 凭据、worker 控制或提供方专用对象。本分支不添加该 endpoint 或 UI。

## 考虑过的替代方案

**面向模型的工具**——拒绝。结构可视化是 host/UI 需求；模型工具会把大型图结果保留在会话历史中，却没有提供必要的模型能力。

**内联 JSON 或图文件路径**——拒绝，因为两者都会把调用方控制的数据伪装成已配置 palace，并授予不必要的文件权限。

**第二个导出进程或本地服务器**——拒绝，因为它会重复提供方发现、后端选择、collection 所有权、超时和拆卸。

**上游 `build_graph()`**——本操作拒绝使用，因为它可能在 DSH 执行结果上限前分页读取完整 palace。经审查的 bridge 操作在配置的 metadata 扫描上限处停止。

## 后果

图获取共享原生提供方的进程、后端、collection、健康状态、取消、重启、flush 和销毁生命周期。对于稳定的后端分页顺序，结果是确定性的，并且不包含 renderer 坐标。部分扫描或任何节点、边、字节裁剪都会设置 `truncated`；调用方可以明确渲染部分状态。实现 `MemoryRuntime` 的提供方必须实现图操作，即使其实现只是明确拒绝不受支持的操作。
