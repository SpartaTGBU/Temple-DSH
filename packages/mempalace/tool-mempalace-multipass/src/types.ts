/**
 * Stable DTOs for MemPalace graph exploration exports.
 * @module @deepseek-ai/dsh-tool-mempalace-multipass/types
 */

/** Serialized format marker for normalized MemPalace multipass graph exports. */
export const MEMPALACE_MULTIPASS_FORMAT = 'dsh.mempalace.multipass.graph.v1'

/** Source of the MemPalace-compatible graph JSON accepted by the tool. */
export type MultipassGraphSource = 'direct' | 'file'

/** Room node normalized from MemPalace `build_graph` node data. */
export interface MultipassRoomNode {
  /** Stable node id derived from the room name. */
  readonly id: string
  /** Original MemPalace room slug/name. */
  readonly room: string
  /** Wings containing this room, sorted and de-duplicated. */
  readonly wings: readonly string[]
  /** Halls reported for this room, sorted and de-duplicated. */
  readonly halls: readonly string[]
  /** Drawer count reported for this room. */
  readonly count: number
  /** Last known dates reported for this room, sorted and de-duplicated. */
  readonly dates: readonly string[]
  /** True when no other room can be reached through a shared wing. */
  readonly isolated: boolean
}

/** Cross-wing passive tunnel edge normalized from MemPalace graph edge data. */
export interface MultipassTunnelEdge {
  /** Stable edge id derived from room, wings, and hall. */
  readonly id: string
  /** Original MemPalace room slug/name that bridges wings. */
  readonly room: string
  /** Sorted source wing name. */
  readonly wingA: string
  /** Sorted target wing name. */
  readonly wingB: string
  /** Hall label when MemPalace supplied one; empty string means no hall label. */
  readonly hall: string
  /** Drawer count associated with the tunnel room. */
  readonly count: number
}

/** Wing summary derived from normalized room placements. */
export interface MultipassWingSummary {
  /** Wing name as MemPalace reported it. */
  readonly name: string
  /** Sorted rooms in the wing. */
  readonly rooms: readonly string[]
  /** Sum of room counts across this wing's placements. */
  readonly count: number
  /** True when this wing has no cross-wing tunnel edge. */
  readonly isolated: boolean
}

/** One reachable room in a multi-hop exploration from a requested start room. */
export interface MultipassPathStep {
  /** Reached room. */
  readonly room: string
  /** Hop distance from the start room. */
  readonly hop: number
  /** Room sequence from the start room to this step. */
  readonly path: readonly string[]
  /** Shared wings that connect this room to the previous path room. */
  readonly connectedVia: readonly string[]
}

/** Deterministic point for a 3D/graph renderer. */
export interface MultipassVisualizationNode {
  /** Stable renderer node id. */
  readonly id: string
  /** Node kind understood by a renderer. */
  readonly kind: 'room' | 'wing'
  /** Display label. */
  readonly label: string
  /** Grouping key for color/layout. */
  readonly group: string
  /** Deterministic X coordinate hint. */
  readonly x: number
  /** Deterministic Y coordinate hint. */
  readonly y: number
  /** Deterministic Z coordinate hint. */
  readonly z: number
}

/** Deterministic link for a 3D/graph renderer. */
export interface MultipassVisualizationLink {
  /** Stable renderer link id. */
  readonly id: string
  /** Source node id. */
  readonly source: string
  /** Target node id. */
  readonly target: string
  /** Link kind understood by a renderer. */
  readonly kind: 'placement' | 'passive_tunnel' | 'path'
  /** Optional room associated with the link. */
  readonly room?: string
  /** Optional hall associated with the link. */
  readonly hall?: string
}

/** Renderer-neutral 3D/graph visualization export. */
export interface MultipassVisualizationGraph {
  /** Deterministic nodes for local browser or native graph renderers. */
  readonly nodes: readonly MultipassVisualizationNode[]
  /** Deterministic links for local browser or native graph renderers. */
  readonly links: readonly MultipassVisualizationLink[]
}

/** Stable normalized graph export returned by the multipass tool. */
export interface MultipassGraphExport {
  /** Format marker for compatibility checks. */
  readonly format: typeof MEMPALACE_MULTIPASS_FORMAT
  /** Source of the input JSON. */
  readonly source: MultipassGraphSource
  /** Normalized room nodes. */
  readonly rooms: readonly MultipassRoomNode[]
  /** Normalized cross-wing passive tunnels. */
  readonly tunnels: readonly MultipassTunnelEdge[]
  /** Derived wing summaries. */
  readonly wings: readonly MultipassWingSummary[]
  /** Multi-hop path data, present when a start room was requested and found. */
  readonly paths: readonly MultipassPathStep[]
  /** Renderer-neutral visualization seam. */
  readonly visualization: MultipassVisualizationGraph
  /** Summary counts over the normalized graph. */
  readonly stats: {
    readonly roomCount: number
    readonly wingCount: number
    readonly tunnelCount: number
    readonly isolatedRoomCount: number
    readonly isolatedWingCount: number
    readonly maxHop: number
  }
}
