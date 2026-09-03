# 原生 MemPalace 自动记忆

[English](2026-09-02-native-mempalace-memory.md) | 中文

## 决策

Temple-DSH 把长期记忆视为原生能力，而不是面向模型的 MCP 工具。与提供方无关的 `ctx.memory` 服务把存储与 agent 生命周期行为分离。`memory-context` 消费者在轮次首次模型请求前召回一次，并异步捕获一组成功完成的交换。MemPalace 提供方通过一个受管持久 sidecar 调用直接 Python API。

## 边界

召回上下文有界并明确标记为不可信。只有直接用户文本构成查询；捕获排除插件上下文、推理和工具流量。subagent 捕获需要显式启用。只追加会话日志保持不变，除了 pre-step 流程正常接纳的带来源召回消息。

进程边界使用无 shell 的 argv 执行、带请求 id 的 JSONL 帧、响应大小上限、取消截止时间、有界捕获队列、优雅 flush 和进程树拆卸。原始 stderr 和凭据不会成为模型上下文。

## 替代方案

MCP 包装器要求显式工具调用，并把记忆暴露为模型选择，因此无法保证召回或捕获。每次操作启动一个 Python 进程可简化隔离，但会重复启动与 embedding 初始化成本。持久 sidecar 在保留 Temple-DSH 进程所有权的同时复用一个后端 collection。

## 验证

聚焦测试覆盖首次 step 召回、注入上限、超时退化、恰好一次捕获、subagent 过滤、worker 复用、超时或错误输出后的重启、队列溢出、flush 和销毁。实时 Chroma 往返通过打包 bridge 捕获并召回一个已知值。
