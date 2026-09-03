# 自动长期记忆

[English](memory.md) | 中文

自动记忆能力分离与提供方无关的服务（`ctx.memory`）、生命周期消费者和存储提供方。[`dsh-memory-context`](../../packages/memory/memory-context) 在轮次首次模型请求前召回，并在成功完成后无需工具调用地捕获轮次。[`dsh-memory-mempalace`](../../packages/memory/memory-mempalace) 在一个受管 Python 进程中通过直接 MemPalace API 提供服务。

来源：[`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

## 召回

`recall` 接收会话 id、直接用户查询、结果上限和 UTF-8 字节上限。后端返回提供方无关的记忆片段和截断标记。消费者再次应用自身上限，把注入消息标记为不可信背景，并把超时、取消或后端失败视为空召回，而不是失败的模型轮次。

## 捕获

`captureTurn` 接收一组已完成用户/助手交换，以及会话、轮次、完成时间和可选 workspace。消费者只在 `completed` 的 `turn/end` 后提交直接用户文本和可见助手文本；默认排除插件消息、推理、工具流量和 subagent 会话。`flush` 等待已接受捕获工作。

## 图探索

`exploreGraph` 是针对已配置提供方的可信 host 操作。其请求包含可选起始 room，以及严格的节点、边、跳数和 UTF-8 结果字节上限；不能包含图数据、路径、命令、可执行文件或提供方配置。结果包含与 renderer 无关的 room/wing 节点、placement/tunnel/path 边、确定性广度优先访问、计数和明确的截断标记。此包不提供 Dashboard endpoint 或 UI；独立且经过认证的 host 消费者可以转发 DTO 并绑定请求取消，而不暴露 MemPalace 进程或存储权限。

## 生命周期和安全

MemPalace 提供方通过 `ctx.subprocess` 启动一个惰性 worker，以带请求 id 的 JSONL 帧通信，并在协议失败或请求超时后重启。图获取复用该 worker 和 collection，在配置的扫描上限处停止 metadata 分页，在 Python 与 TypeScript 中应用结果上限，并在取消时终止 worker。捕获队列有固定最大值，并明确拒绝溢出。子进程 stderr、环境凭据和连接细节不会进入召回上下文或图数据。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime-abstract-seam"></a>

### `ctx.memory` — `MemoryRuntime` (abstract seam)

Swappable long-term memory provider. Implementations own storage/process lifecycle; consumers own when recall and capture occur.

```ts cordis-catalog
/**
 * Return non-secret backend health without starting model-facing work.
 * @returns the current backend state and queue counters.
 */
abstract status(): MemoryStatus

/**
 * Recall bounded background information for one turn.
 * @param request - session, query, item limit, and byte limit.
 * @param signal - optional cancellation for this recall.
 * @returns provider-neutral recalled fragments within the requested bounds.
 */
abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

/**
 * Acquire a bounded renderer-neutral graph from this configured backend.
 * The provider must read its active store directly; callers cannot supply a
 * graph, path, command, or executable.
 * @param request - strict node, edge, hop, and serialized-byte limits.
 * @param signal - optional cancellation for this acquisition.
 * @returns deterministic graph and traversal data within every requested limit.
 */
abstract exploreGraph(request: MemoryGraphRequest, signal?: AbortSignal): Promise<MemoryGraphResult>

/**
 * Enqueue one completed turn for durable capture.
 * @param turn - completed direct-user and visible-assistant exchange.
 */
abstract captureTurn(turn: MemoryCaptureTurn): Promise<void>

/** Wait until every accepted capture reaches the backend. */
abstract flush(): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
