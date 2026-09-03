/** Persistent native MemPalace provider over a private JSONL sidecar. @module @deepseek-ai/dsh-memory-mempalace */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { fileURLToPath } from 'node:url'
import { MemoryRuntime } from '@deepseek-ai/dsh-memory'
import type { MemoryCaptureTurn, MemoryGraphRequest, MemoryGraphResult, MemoryInspectionSource, MemoryRecallItem, MemoryRecallRequest, MemoryRecallResult, MemoryStatus } from '@deepseek-ai/dsh-memory'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-subprocess'
import { parseGraphResult, validateGraphRequest } from './graph.ts'

/** Cordis plugin name. */
export const name = 'memory-mempalace'
/** Services required by the provider. */
export const inject = ['subprocess']

/** Persistent sidecar and MemPalace location configuration. */
export interface Config {
  /** Python executable or absolute path. @default python */
  readonly pythonExecutable?: string
  /** Override the packaged bridge, primarily for integration tests. */
  readonly bridgePath?: string
  /** Explicit MemPalace palace directory. */
  readonly palacePath?: string
  /** Explicit MemPalace drawer collection. */
  readonly collectionName?: string
  /** MemPalace backend override; omission follows MemPalace config/env/detection. */
  readonly backend?: string
  /** Wing used for automatically captured DSH turns. @default wing_general */
  readonly wing?: string
  /** Maximum queued completed turns. @default 256 */
  readonly maxPendingCaptures?: number
  /** Request timeout in milliseconds. @default 10000 */
  readonly requestTimeoutMs?: number
  /** Maximum JSONL request or response frame bytes. @default 1048576 */
  readonly maxFrameBytes?: number
  /** Managed-process termination grace in milliseconds. @default 2000 */
  readonly graceMs?: number
  /** Maximum nodes accepted in one host graph response. @default 500 */
  readonly maxGraphNodes?: number
  /** Maximum edges accepted in one host graph response. @default 2000 */
  readonly maxGraphEdges?: number
  /** Maximum graph traversal depth. @default 4 */
  readonly maxGraphHops?: number
  /** Maximum serialized bytes accepted in one graph result. @default 524288 */
  readonly maxGraphBytes?: number
  /** Maximum palace metadata records inspected by one graph operation. @default 10000 */
  readonly maxGraphScanRecords?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  pythonExecutable: z.string().default('python'),
  bridgePath: z.string(),
  palacePath: z.string(),
  collectionName: z.string(),
  backend: z.string(),
  wing: z.string().default('wing_general'),
  maxPendingCaptures: z.number().step(1).min(1).max(10_000).default(256),
  requestTimeoutMs: z.number().step(1).min(1).max(300_000).default(10_000),
  maxFrameBytes: z.number().step(1).min(2048).max(16_777_216).default(1_048_576),
  graceMs: z.number().step(1).min(1).max(30_000).default(2000),
  maxGraphNodes: z.number().step(1).min(1).max(5000).default(500),
  maxGraphEdges: z.number().step(1).min(1).max(20_000).default(2000),
  maxGraphHops: z.number().step(1).min(0).max(16).default(4),
  maxGraphBytes: z.number().step(1).min(1024).max(8_388_608).default(524_288),
  maxGraphScanRecords: z.number().step(1).min(1).max(100_000).default(10_000),
})

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly cleanup: () => void
}

interface WorkerResponse {
  readonly id: number
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: string
}

/** Native MemPalace provider with one lazy, persistent managed worker. */
export class MemPalaceMemory extends MemoryRuntime {
  /** Loader waits for the managed subprocess service before constructing this provider. */
  static inject = ['subprocess']
  /** Schemastery configuration applied when the class is loaded as a plugin. */
  static Config = Config
  private handle: SubprocessHandle | undefined
  private responseChunks: Buffer[] = []
  private responseBytes = 0
  private starting: Promise<void> | undefined
  private retiring: Promise<void> = Promise.resolve()
  private retirementError: Error | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly captures: MemoryCaptureTurn[] = []
  private pumpPromise: Promise<void> | undefined
  private activeCapture = false
  private state: MemoryStatus['state'] = 'starting'
  private detail = 'worker starts lazily on first recall or capture'
  private workerStarts = 0
  private stopping = false

  constructor(private readonly owner: Context, private readonly config: Config = {}) {
    super(owner)
    owner.effect(() => async () => { await this.shutdown() }, 'memory-mempalace worker teardown')
  }

  status(): MemoryStatus {
    return {
      state: this.state,
      backend: 'mempalace',
      detail: this.detail,
      pendingCaptures: this.captures.length + (this.activeCapture ? 1 : 0),
      workerStarts: this.workerStarts,
    }
  }

  override async inspectionSource(signal?: AbortSignal): Promise<MemoryInspectionSource> {
    const record = asRecord(await this.request('configuration', {}, signal))
    if (
      record?.kind !== 'mempalace'
      || typeof record.palacePath !== 'string'
      || typeof record.collectionName !== 'string'
      || typeof record.storageBackend !== 'string'
      || typeof record.wing !== 'string'
    ) {
      throw new Error('memory-mempalace: worker emitted invalid inspection configuration')
    }
    return {
      kind: 'mempalace',
      palacePath: record.palacePath,
      collectionName: record.collectionName,
      storageBackend: record.storageBackend,
      wing: record.wing,
    }
  }

  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    const raw = await this.request('recall', request, signal)
    const record = asRecord(raw)
    const values = Array.isArray(record?.items) ? record.items : []
    const items: MemoryRecallItem[] = []
    let bytes = 0
    let truncated = record?.truncated === true
    for (const value of values) {
      if (items.length >= request.limit) { truncated = true; break }
      const item = memoryItem(value)
      if (item === undefined) continue
      const size = new TextEncoder().encode(item.text).byteLength
      if (bytes + size > request.maxBytes) { truncated = true; break }
      items.push(item)
      bytes += size
    }
    return { backend: 'mempalace', items, truncated }
  }

  async exploreGraph(request: MemoryGraphRequest, signal?: AbortSignal): Promise<MemoryGraphResult> {
    validateGraphRequest(request, {
      maxNodes: this.config.maxGraphNodes ?? 500,
      maxEdges: this.config.maxGraphEdges ?? 2000,
      maxHops: this.config.maxGraphHops ?? 4,
      maxBytes: Math.min(this.config.maxGraphBytes ?? 524_288, (this.config.maxFrameBytes ?? 1_048_576) - 1024),
    })
    const raw = await this.request('graph', {
      ...request,
      maxScanRecords: this.config.maxGraphScanRecords ?? 10_000,
    }, signal)
    return parseGraphResult(raw, request, this.config.maxGraphScanRecords ?? 10_000)
  }

  captureTurn(turn: MemoryCaptureTurn): Promise<void> {
    return Promise.resolve().then(() => { this.enqueueCapture(turn) })
  }

  private enqueueCapture(turn: MemoryCaptureTurn): void {
    this.assertPayloadFits('capture', turn)
    const max = this.config.maxPendingCaptures ?? 256
    if (this.captures.length + (this.activeCapture ? 1 : 0) >= max) {
      this.state = 'degraded'
      this.detail = `capture queue full (${String(max)})`
      throw new Error(`memory-mempalace: capture queue full (${String(max)})`)
    }
    this.captures.push(turn)
    this.startPump()
  }

  async flush(): Promise<void> {
    while (this.pumpPromise !== undefined) await this.pumpPromise
    if (this.handle !== undefined) await this.request('flush', {})
  }

  private startPump(): void {
    if (this.pumpPromise !== undefined) return
    this.pumpPromise = this.pump().finally(() => {
      this.pumpPromise = undefined
      if (this.captures.length > 0) this.startPump()
    })
  }

  private async pump(): Promise<void> {
    let turn: MemoryCaptureTurn | undefined
    while ((turn = this.captures.shift()) !== undefined) {
      this.activeCapture = true
      try {
        await this.request('capture', turn)
      } catch (error) {
        this.state = 'degraded'
        this.detail = `capture failed: ${safeMessage(error)}`
        this.owner.logger.warn(`memory-mempalace capture failed: ${safeMessage(error)}`)
      } finally {
        this.activeCapture = false
      }
    }
  }

  private async request(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.ensureStarted()
    signal?.throwIfAborted()
    const handle = this.handle
    const stdin = handle?.stdin
    if (stdin === undefined) throw new Error('memory-mempalace: worker stdin unavailable')
    this.assertPayloadFits(method, payload)
    const id = this.nextId++
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return await new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        const error = new Error(`memory-mempalace: ${method} ${signal?.aborted ? 'cancelled' : 'timed out'}`)
        this.failWorker(error, handle)
      }
      const cleanup = (): void => { combined.removeEventListener('abort', onAbort) }
      this.pending.set(id, { resolve, reject, cleanup })
      combined.addEventListener('abort', onAbort, { once: true })
      if (combined.aborted) {
        onAbort()
        return
      }
      const frame = `${JSON.stringify({ id, method, payload })}\n`
      stdin.write(frame, 'utf8', (error) => {
        if (error !== null && error !== undefined) {
          this.failWorker(new Error(`memory-mempalace: worker write failed: ${error.message}`), handle)
        }
      })
    })
  }

  private assertPayloadFits(method: string, payload: unknown): void {
    const bytes = new TextEncoder().encode(JSON.stringify({ id: this.nextId, method, payload })).byteLength + 1
    const max = this.config.maxFrameBytes ?? 1_048_576
    if (bytes > max) throw new Error(`memory-mempalace: ${method} request exceeded maxFrameBytes`)
  }

  private async ensureStarted(): Promise<void> {
    if (this.handle !== undefined) return
    if (this.starting !== undefined) {
      await this.starting
      return
    }
    if (this.stopping) throw new Error('memory-mempalace: provider is stopping')
    this.starting = this.startWorkerAfterRetirement().finally(() => { this.starting = undefined })
    await this.starting
  }

  private async startWorkerAfterRetirement(): Promise<void> {
    await this.retiring
    if (this.retirementError !== undefined) throw this.retirementError
    if (this.stopping) throw new Error('memory-mempalace: provider is stopping')
    await this.startWorker()
  }

  private async startWorker(): Promise<void> {
    this.state = 'starting'
    this.detail = 'starting persistent MemPalace worker'
    const executableName = this.config.pythonExecutable ?? 'python'
    try {
      const executable = await this.owner.subprocess.resolveExecutable(executableName)
      const bridge = this.config.bridgePath ?? fileURLToPath(new URL('../resources/bridge.py', import.meta.url))
      const argv = [executable, bridge]
      if (this.config.palacePath !== undefined) argv.push('--palace', this.config.palacePath)
      if (this.config.collectionName !== undefined) argv.push('--collection', this.config.collectionName)
      if (this.config.backend !== undefined) argv.push('--backend', this.config.backend)
      argv.push('--wing', this.config.wing ?? 'wing_general')
      argv.push('--max-frame-bytes', String(this.config.maxFrameBytes ?? 1_048_576))
      const handle = this.owner.subprocess.spawn({
        argv,
        cwd: process.cwd(),
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 8192 } },
        graceMs: this.config.graceMs ?? 2000,
      })
      if (handle.stdin === undefined || handle.stdout === undefined) {
        handle.terminate()
        await handle.waitForExit()
        throw new Error('worker pipes unavailable')
      }
      this.handle = handle
      this.workerStarts += 1
      this.responseChunks = []
      this.responseBytes = 0
      handle.stdout.on('data', (chunk: Buffer | string) => {
        if (this.handle === handle) this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      handle.stdin.on('error', (error) => {
        if (this.handle === handle) this.failWorker(new Error(`memory-mempalace: worker stdin failed: ${error.message}`), handle)
      })
      void handle.done.then(
        (outcome) => {
          if (this.handle === handle && !this.stopping) {
            this.failWorker(new Error(`memory-mempalace: worker exited (${String(outcome.exitCode)})`))
          }
        },
        (error: unknown) => {
          if (this.handle === handle) this.failWorker(new Error(`memory-mempalace: worker failed: ${safeMessage(error)}`))
        },
      )
      this.state = 'ready'
      this.detail = `persistent worker pid ${String(handle.pid)}`
    } catch (error) {
      this.state = 'unavailable'
      this.detail = `worker unavailable: ${safeMessage(error)}`
      throw new Error(`memory-mempalace: unable to start persistent worker: ${safeMessage(error)}`)
    }
  }

  private onLine(line: string): void {
    if (new TextEncoder().encode(line).byteLength > (this.config.maxFrameBytes ?? 1_048_576)) {
      this.failWorker(new Error('memory-mempalace: worker response exceeded maxFrameBytes'))
      return
    }
    let response: WorkerResponse
    try {
      response = JSON.parse(line) as WorkerResponse
    } catch {
      this.failWorker(new Error('memory-mempalace: worker emitted invalid JSON'))
      return
    }
    if (!Number.isSafeInteger(response.id) || typeof response.ok !== 'boolean') {
      this.failWorker(new Error('memory-mempalace: worker emitted an invalid response envelope'))
      return
    }
    const pending = this.pending.get(response.id)
    if (pending === undefined) return
    this.pending.delete(response.id)
    pending.cleanup()
    if (response.ok) {
      this.state = 'ready'
      this.detail = `persistent worker pid ${String(this.handle?.pid ?? -1)}`
      pending.resolve(response.result)
    } else {
      pending.reject(new Error(`memory-mempalace: ${response.error ?? 'worker request failed'}`))
    }
  }

  private onData(chunk: Buffer): void {
    const maximum = this.config.maxFrameBytes ?? 1_048_576
    let offset = 0
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(0x0A, offset)
      const end = newline < 0 ? chunk.byteLength : newline
      const segment = chunk.subarray(offset, end)
      const bufferedBytes = this.responseBytes + segment.byteLength
      if (bufferedBytes > maximum || (newline >= 0 && bufferedBytes >= maximum)) {
        this.failWorker(new Error('memory-mempalace: worker response exceeded maxFrameBytes'))
        return
      }
      if (segment.byteLength > 0) {
        this.responseChunks.push(segment)
        this.responseBytes = bufferedBytes
      }
      if (newline < 0) return
      const line = Buffer.concat(this.responseChunks, this.responseBytes).toString('utf8')
      this.responseChunks = []
      this.responseBytes = 0
      this.onLine(line)
      if (this.handle === undefined) return
      offset = newline + 1
    }
  }

  private failWorker(error: Error, expected: SubprocessHandle | undefined = this.handle): void {
    if (expected !== undefined && this.handle !== expected) return
    const handle = this.handle
    this.handle = undefined
    this.responseChunks = []
    this.responseBytes = 0
    if (!this.stopping) {
      this.state = 'degraded'
      this.detail = error.message
    }
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
    if (handle !== undefined) {
      handle.terminate()
      this.retirementError = undefined
      this.retiring = handle.waitForExit().then((exited) => {
        if (!exited) throw new Error('memory-mempalace: worker tree did not terminate')
      }).catch((error: unknown) => {
        this.retirementError = new Error(`memory-mempalace: worker teardown failed: ${safeMessage(error)}`)
        this.state = 'unavailable'
        this.detail = this.retirementError.message
      })
    }
  }

  private async shutdown(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    try {
      try { await this.starting } catch { /* startup failure leaves no live worker */ }
      await this.flush()
      if (this.handle !== undefined) {
        try { await this.request('shutdown', {}) } catch { /* worker failure is completed by forced termination below */ }
      }
    } finally {
      const handle = this.handle
      this.handle = undefined
      this.responseChunks = []
      this.responseBytes = 0
      handle?.terminate()
      if (handle !== undefined) {
        await handle.waitForExit()
      }
      await this.retiring
      this.state = 'stopped'
      this.detail = 'provider disposed'
      this.stopping = false
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function memoryItem(value: unknown): MemoryRecallItem | undefined {
  const record = asRecord(value)
  if (record === undefined || typeof record.text !== 'string' || record.text.trim().length === 0) return undefined
  return {
    text: record.text,
    ...(typeof record.drawerId === 'string' ? { drawerId: record.drawerId } : {}),
    ...(typeof record.wing === 'string' ? { wing: record.wing } : {}),
    ...(typeof record.room === 'string' ? { room: record.room } : {}),
    ...(typeof record.sourceFile === 'string' ? { sourceFile: record.sourceFile } : {}),
    ...(typeof record.distance === 'number' && Number.isFinite(record.distance) ? { distance: record.distance } : {}),
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register the native persistent MemPalace provider. */
export function apply(ctx: Context, config: Config = {}): void {
  new MemPalaceMemory(ctx, config)
}

export default MemPalaceMemory
