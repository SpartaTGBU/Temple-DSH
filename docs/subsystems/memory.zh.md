# 自动长期记忆

[English](memory.md) | 中文

自动记忆能力分离与提供方无关的服务（`ctx.memory`）、生命周期消费者和存储提供方。[`dsh-memory-context`](../../packages/memory/memory-context) 在轮次首次模型请求前召回，并在成功完成后无需工具调用地捕获轮次。[`dsh-memory-mempalace`](../../packages/memory/memory-mempalace) 在一个受管 Python 进程中通过直接 MemPalace API 提供服务。

来源：[`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

## 召回

`recall` 接收会话 id、直接用户查询、结果上限和 UTF-8 字节上限。后端返回提供方无关的记忆片段和截断标记。消费者再次应用自身上限，把注入消息标记为不可信背景，并把超时、取消或后端失败视为空召回，而不是失败的模型轮次。

## 捕获

`captureTurn` 接收一组已完成用户/助手交换，以及会话、轮次、完成时间和可选 workspace。消费者只在 `completed` 的 `turn/end` 后提交直接用户文本和可见助手文本；默认排除插件消息、推理、工具流量和 subagent 会话。`flush` 等待已接受捕获工作。

## 生命周期和安全

MemPalace 提供方通过 `ctx.subprocess` 启动一个惰性 worker，以带请求 id 的 JSONL 帧通信，并在协议失败或请求超时后重启。捕获队列有固定最大值，并明确拒绝溢出。`inspectionSource()` 通过同一个提供方配置为只读消费者解析非机密存储坐标。子进程 stderr、环境凭据和连接细节不会进入召回上下文。

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
 * Resolve non-secret storage coordinates through the provider's own configuration path.
 * Providers that do not support local inspection return `undefined`.
 * @param signal - optional cancellation for provider-side resolution.
 * @returns a read-only inspection source, or `undefined` when unsupported.
 */
async inspectionSource(signal?: AbortSignal): Promise<MemoryInspectionSource | undefined>

/**
 * Recall bounded background information for one turn.
 * @param request - session, query, item limit, and byte limit.
 * @param signal - optional cancellation for this recall.
 * @returns provider-neutral recalled fragments within the requested bounds.
 */
abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

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
