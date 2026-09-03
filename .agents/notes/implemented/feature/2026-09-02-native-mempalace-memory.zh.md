# Agent Note: 原生 MemPalace 自动记忆

Status: implemented

[English](2026-09-02-native-mempalace-memory.md) | 中文

## 问题

显式的面向模型记忆工具无法保证在请求前召回，也无法保证在轮次完成后捕获。每次操作都启动 Python 还会重复初始化后端与嵌入模型，而 MCP 服务器会增加第二个应用和生命周期权威。

## 决策

Temple-DSH 把长期记忆视为原生能力。与提供方无关的 `ctx.memory` 服务把存储与 agent 生命周期行为分离。`memory-context` 消费者在轮次首次模型请求前召回一次，并异步捕获一组成功完成的交换。MemPalace 提供方通过一个受管持久 sidecar 调用直接 Python API。

召回上下文有界并明确标记为不可信。只有直接用户文本构成查询；捕获排除插件上下文、推理和工具流量。subagent 捕获需要显式启用。只追加会话日志只会因 pre-step 流程正常接纳的带来源召回消息而变化。

进程使用无 shell 的 argv 执行、带请求 id 的 JSONL 帧、响应大小上限、取消截止时间、有界捕获队列、优雅 flush 和进程树拆卸。原始 stderr 和凭据不会成为模型上下文。[由提供方拥有的 palace 图探索](2026-09-02-mempalace-multipass-graph-seam.zh.md)扩展同一服务和 worker，且不增加模型工具或第二个进程。

## 考虑过的替代方案

**MCP 或面向模型的记忆工具**——拒绝，因为模型可能省略必要的召回或捕获，而且服务器会复制应用生命周期。

**每次操作启动一个 Python 进程**——拒绝，因为重复初始化后端 collection 和嵌入模型会增加延迟与资源使用量。

## 后果

一个已配置提供方拥有召回、捕获、状态、flush、图获取、后端选择和 worker 拆卸。提供方故障会使自动召回降级，但不会让模型轮次失败；已接受的捕获工作有界并会 flush。聚焦测试覆盖首次 step 召回、注入上限、超时降级、恰好一次捕获、subagent 过滤、worker 复用/重启、队列溢出、flush 和销毁。一个 fixture 针对与直接 MemPalace API 兼容的实现执行打包 bridge；实际安装的 Chroma 往返取决于环境。
