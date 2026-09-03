/** Provider-neutral automatic long-term memory capability seam. @module @deepseek-ai/dsh-memory */

import { Context, Service } from '@deepseek-ai/cordis'

/** Operational state of the configured memory backend. */
export type MemoryBackendState = 'ready' | 'starting' | 'degraded' | 'unavailable' | 'stopped'

/** Non-secret backend status for diagnostics and UI. */
export interface MemoryStatus {
  readonly state: MemoryBackendState
  readonly backend: string
  readonly detail?: string
  readonly pendingCaptures: number
  readonly workerStarts: number
}

/** Read-only storage coordinates exposed by a memory provider for inspection consumers. */
export interface MemoryInspectionSource {
  readonly kind: 'mempalace'
  readonly palacePath: string
  readonly collectionName: string
  readonly storageBackend: string
  readonly wing: string
}

/** One recalled memory fragment. */
export interface MemoryRecallItem {
  readonly text: string
  readonly drawerId?: string
  readonly wing?: string
  readonly room?: string
  readonly sourceFile?: string
  readonly distance?: number
}

/** Automatic recall request for one model turn. */
export interface MemoryRecallRequest {
  readonly sessionId: string
  readonly query: string
  readonly limit: number
  readonly maxBytes: number
}

/** Bounded recall result returned by a backend. */
export interface MemoryRecallResult {
  readonly backend: string
  readonly items: readonly MemoryRecallItem[]
  readonly truncated: boolean
}

/** Hard limits selected by a trusted host graph consumer for one palace read. */
export interface MemoryGraphRequest {
  /** Optional room from which to compute deterministic breadth-first visits. */
  readonly startRoom?: string
  /** Maximum room and wing nodes in the complete result. */
  readonly maxNodes: number
  /** Maximum placement, tunnel, and traversal edges in the complete result. */
  readonly maxEdges: number
  /** Maximum traversal depth; zero permits only the selected start-room visit. */
  readonly maxHops: number
  /** Maximum UTF-8 bytes in the serialized result. */
  readonly maxBytes: number
}

/** Renderer-neutral node acquired from the configured memory provider. */
export interface MemoryGraphNode {
  readonly id: string
  readonly kind: 'room' | 'wing'
  readonly label: string
  readonly count: number
  readonly isolated: boolean
}

/** Renderer-neutral edge acquired from the configured memory provider. */
export interface MemoryGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: 'placement' | 'tunnel' | 'path'
  readonly count: number
}

/** One deterministic breadth-first room visit. */
export interface MemoryGraphVisit {
  readonly nodeId: string
  readonly hop: number
  readonly parentNodeId?: string
  readonly via: readonly string[]
}

/** Bounded palace graph projection for host APIs and local UI renderers. */
export interface MemoryGraphResult {
  readonly format: 'dsh.memory.graph.v1'
  readonly backend: string
  readonly nodes: readonly MemoryGraphNode[]
  readonly edges: readonly MemoryGraphEdge[]
  readonly visits: readonly MemoryGraphVisit[]
  readonly truncated: boolean
  readonly stats: {
    readonly scannedRecords: number
    readonly nodeCount: number
    readonly edgeCount: number
    readonly maxHop: number
  }
}

/** One complete user/assistant exchange captured after a committed turn. */
export interface MemoryCaptureTurn {
  readonly sessionId: string
  readonly turn: number
  readonly userText: string
  readonly assistantText: string
  readonly completedAt: number
  readonly cwd?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRuntime
  }
}

/**
 * Swappable long-term memory provider. Implementations own storage/process
 * lifecycle; consumers own when recall and capture occur.
 */
export abstract class MemoryRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

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
  inspectionSource(signal?: AbortSignal): Promise<MemoryInspectionSource | undefined> {
    void signal
    return Promise.resolve(undefined)
  }

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
}

export default MemoryRuntime
