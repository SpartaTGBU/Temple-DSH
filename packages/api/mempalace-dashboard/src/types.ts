/** Browser-safe MemPalace dashboard projection values. */

/** Logical endpoint inside the shared `/api` RPC channel. */
export const MEMPALACE_DASHBOARD_ENDPOINT = 'mempalaceDashboard/inspect'

/** Why one requested MemPalace view cannot be answered from persisted state. */
export type MemPalaceUnavailableReason =
  | 'memory-provider-not-found'
  | 'memory-provider-unsupported'
  | 'memory-provider-unavailable'
  | 'palace-not-found'
  | 'drawer-index-not-found'
  | 'unsupported-backend'
  | 'sqlite-read-failed'
  | 'knowledge-graph-not-found'
  | 'tunnels-not-found'
  | 'sidecar-read-failed'
  | 'retrieval-traces-not-persisted'
  | 'memory-health-not-persisted'

/** Explicit unavailable state; callers must render this instead of guessing. */
export interface MemPalaceUnavailable {
  readonly available: false
  readonly reason: MemPalaceUnavailableReason
  readonly message: string
}

/** Available view wrapper. */
export interface MemPalaceAvailable<T> {
  readonly available: true
  readonly value: T
}

/** Available-or-unavailable result for one independent dashboard section. */
export type MemPalaceSection<T> = MemPalaceAvailable<T> | MemPalaceUnavailable

/** User-supplied dashboard filters. Empty strings are normalized away. */
export interface MemPalaceDashboardRequest {
  readonly wing?: string
  readonly room?: string
  readonly query?: string
  readonly limit?: number
}

/** Resolved local MemPalace location, without secrets. */
export interface MemPalaceLocationView {
  readonly palacePath: string
  readonly collectionName: string
  readonly backend: string
  readonly wing: string
  readonly authority: 'memory-provider' | 'standalone-projection'
}

/** Safe operational facts copied from `ctx.memory.status()`. */
export interface MemPalaceProviderStatusView {
  readonly state: 'ready' | 'starting' | 'degraded' | 'unavailable' | 'stopped'
  readonly backend: string
  readonly pendingCaptures: number
  readonly workerStarts: number
}

/** Drawer row used by inspection and maintenance views. */
export interface MemPalaceDrawerView {
  readonly id: string
  readonly wing: string
  readonly room: string
  readonly hall: string
  readonly sourceFile?: string
  readonly date?: string
  readonly preview: string
}

/** Room aggregate under one wing. */
export interface MemPalaceRoomView {
  readonly wing: string
  readonly room: string
  readonly hall: string
  readonly drawerCount: number
  readonly latestDate?: string
}

/** Wing aggregate. */
export interface MemPalaceWingView {
  readonly wing: string
  readonly drawerCount: number
  readonly roomCount: number
}

/** Passive or explicit tunnel edge. */
export interface MemPalaceTunnelView {
  readonly id: string
  readonly kind: 'passive' | 'explicit' | 'topic' | 'entity' | 'unknown'
  readonly sourceWing: string
  readonly sourceRoom: string
  readonly targetWing: string
  readonly targetRoom: string
  readonly label?: string
  readonly drawerCount?: number
  readonly updatedAt?: string
}

/** Inspectable palace structure backed by drawer metadata and tunnel sidecars. */
export interface MemPalaceStructureView {
  readonly wings: readonly MemPalaceWingView[]
  readonly rooms: readonly MemPalaceRoomView[]
  readonly drawers: readonly MemPalaceDrawerView[]
  readonly tunnels: MemPalaceSection<readonly MemPalaceTunnelView[]>
}

/** Knowledge-graph fact row for timeline and KG views. */
export interface MemPalaceKnowledgeFactView {
  readonly id: string
  readonly subject: string
  readonly predicate: string
  readonly object: string
  readonly current: boolean
  readonly validFrom?: string
  readonly validTo?: string
  readonly confidence?: number
  readonly sourceFile?: string
  readonly sourceDrawerId?: string
  readonly extractedAt?: string
}

/** Knowledge-graph projection with summary counts and recent facts. */
export interface MemPalaceKnowledgeGraphView {
  readonly entities: number
  readonly facts: number
  readonly currentFacts: number
  readonly expiredFacts: number
  readonly relationshipTypes: readonly string[]
  readonly timeline: readonly MemPalaceKnowledgeFactView[]
}

/** Persisted health signals the adapter can prove without running maintenance jobs. */
export interface MemPalaceHealthView {
  readonly drawerCount: number
  readonly wingCount: number
  readonly roomCount: number
  readonly currentFactCount: number | null
  readonly expiredFactCount: number | null
  readonly unavailableSignals: readonly MemPalaceUnavailable[]
}

/** Retrieval tracing state for answers that used MemPalace. */
export interface MemPalaceRetrievalTransparencyView {
  readonly traces: readonly never[]
}

/** Complete dashboard snapshot returned by the Host API. */
export interface MemPalaceDashboardSnapshot {
  readonly generatedAt: string
  readonly provider: MemPalaceSection<MemPalaceProviderStatusView>
  readonly location: MemPalaceSection<MemPalaceLocationView>
  readonly filters: Required<Pick<MemPalaceDashboardRequest, 'limit'>> & Omit<MemPalaceDashboardRequest, 'limit'>
  readonly structure: MemPalaceSection<MemPalaceStructureView>
  readonly knowledgeGraph: MemPalaceSection<MemPalaceKnowledgeGraphView>
  readonly health: MemPalaceSection<MemPalaceHealthView>
  readonly retrievalTransparency: MemPalaceSection<MemPalaceRetrievalTransparencyView>
}
