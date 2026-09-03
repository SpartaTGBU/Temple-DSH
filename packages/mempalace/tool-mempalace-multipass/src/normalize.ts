/**
 * Validation and normalization for MemPalace `build_graph`-compatible JSON.
 * @module @deepseek-ai/dsh-tool-mempalace-multipass/normalize
 */

import { MEMPALACE_MULTIPASS_FORMAT } from './types.ts'
import type {
  MultipassGraphExport,
  MultipassGraphSource,
  MultipassPathStep,
  MultipassRoomNode,
  MultipassTunnelEdge,
  MultipassVisualizationGraph,
  MultipassVisualizationLink,
  MultipassVisualizationNode,
  MultipassWingSummary,
} from './types.ts'

interface NormalizationOptions {
  /** Source label stamped into the export. */
  readonly source: MultipassGraphSource
  /** Optional room to start multi-hop exploration from. */
  readonly startRoom?: string | undefined
  /** Maximum BFS hop count when `startRoom` is present. */
  readonly maxHops: number
  /** Maximum normalized room count accepted by this operation. */
  readonly maxRooms: number
}

interface RawNodeData {
  readonly wings: readonly string[]
  readonly halls: readonly string[]
  readonly count: number
  readonly dates: readonly string[]
}

interface RawEdgeData {
  readonly room: string
  readonly wingA: string
  readonly wingB: string
  readonly hall: string
  readonly count: number
}

interface ParsedBuildGraph {
  readonly nodes: ReadonlyMap<string, RawNodeData>
  readonly edges: readonly RawEdgeData[]
}

/**
 * Normalize MemPalace `build_graph` JSON into a stable DSH multipass export.
 * @param input - Either `[nodes, edges]` or `{ nodes, edges }` using upstream field names.
 * @param options - Source and bounded exploration options.
 * @returns Stable sorted graph export with paths and visualization data.
 */
export function normalizeMemPalaceBuildGraph(input: unknown, options: NormalizationOptions): MultipassGraphExport {
  const parsed = parseBuildGraph(input)
  if (parsed.nodes.size > options.maxRooms) {
    throw new Error(`mempalace_multipass: graph has ${parsed.nodes.size} rooms, above configured maxRooms ${options.maxRooms}`)
  }
  const tunnels = normalizeTunnels(parsed)
  const rooms = normalizeRooms(parsed, reachableRooms(parsed.nodes))
  const wings = normalizeWings(rooms, tunnels)
  const startRoom = normalizeOptionalName(options.startRoom)
  const paths = startRoom === undefined ? [] : buildPaths(parsed.nodes, startRoom, options.maxHops)
  const visualization = buildVisualization(rooms, wings, tunnels, paths)
  const isolatedRoomCount = rooms.filter(room => room.isolated).length
  const isolatedWingCount = wings.filter(wing => wing.isolated).length
  return {
    format: MEMPALACE_MULTIPASS_FORMAT,
    source: options.source,
    rooms,
    tunnels,
    wings,
    paths,
    visualization,
    stats: {
      roomCount: rooms.length,
      wingCount: wings.length,
      tunnelCount: tunnels.length,
      isolatedRoomCount,
      isolatedWingCount,
      maxHop: paths.reduce((max, step) => Math.max(max, step.hop), 0),
    },
  }
}

function parseBuildGraph(input: unknown): ParsedBuildGraph {
  const arrayInput: readonly unknown[] | undefined = Array.isArray(input) ? input : undefined
  let nodesInput: unknown
  let edgesInput: unknown
  if (arrayInput === undefined) {
    const root = asRecord(input, 'graph root')
    nodesInput = root.nodes
    edgesInput = root.edges
  } else {
    nodesInput = arrayInput[0]
    edgesInput = arrayInput[1]
  }
  const nodesRecord = asRecord(nodesInput, 'nodes')
  const nodes = new Map<string, RawNodeData>()
  for (const [room, data] of Object.entries(nodesRecord)) {
    const normalizedRoom = normalizeRequiredName(room, 'room key')
    const node = asRecord(data, `node ${room}`)
    const wings = uniqueSortedStrings(node.wings, `node ${room}.wings`)
    if (wings.length === 0) throw new Error(`mempalace_multipass: node ${room}.wings must contain at least one wing`)
    nodes.set(normalizedRoom, {
      wings,
      halls: uniqueSortedStrings(node.halls ?? [], `node ${room}.halls`),
      count: nonNegativeInteger(node.count ?? 0, `node ${room}.count`),
      dates: uniqueSortedStrings(node.dates ?? [], `node ${room}.dates`),
    })
  }
  if (nodes.size === 0) throw new Error('mempalace_multipass: nodes must contain at least one room')
  const edges = edgesInput === undefined ? synthesizeEdges(nodes) : parseEdges(edgesInput, nodes)
  return { nodes, edges }
}

function parseEdges(input: unknown, nodes: ReadonlyMap<string, RawNodeData>): RawEdgeData[] {
  if (!Array.isArray(input)) throw new Error('mempalace_multipass: edges must be an array')
  return input.map((item, index) => {
    const edge = asRecord(item, `edge ${index}`)
    const room = normalizeRequiredName(edge.room, `edge ${index}.room`)
    const node = nodes.get(room)
    if (node === undefined) throw new Error(`mempalace_multipass: edge ${index}.room references unknown room ${JSON.stringify(room)}`)
    const wingA = normalizeRequiredName(edge.wing_a ?? edge.wingA, `edge ${index}.wing_a`)
    const wingB = normalizeRequiredName(edge.wing_b ?? edge.wingB, `edge ${index}.wing_b`)
    if (wingA === wingB) throw new Error(`mempalace_multipass: edge ${index} must connect two different wings`)
    if (!node.wings.includes(wingA) || !node.wings.includes(wingB)) {
      throw new Error(`mempalace_multipass: edge ${index} wings must both appear on room ${JSON.stringify(room)}`)
    }
    const sorted = [wingA, wingB].sort(compareText)
    const sortedA = sorted[0]
    const sortedB = sorted[1]
    if (sortedA === undefined || sortedB === undefined) throw new Error(`mempalace_multipass: edge ${index} must connect two wings`)
    return {
      room,
      wingA: sortedA,
      wingB: sortedB,
      hall: normalizeOptionalName(edge.hall) ?? '',
      count: nonNegativeInteger(edge.count ?? node.count, `edge ${index}.count`),
    }
  })
}

function synthesizeEdges(nodes: ReadonlyMap<string, RawNodeData>): RawEdgeData[] {
  const edges: RawEdgeData[] = []
  for (const [room, node] of nodes) {
    if (node.wings.length < 2) continue
    const halls = node.halls.length === 0 ? [''] : node.halls
    for (let left = 0; left < node.wings.length; left += 1) {
      for (let right = left + 1; right < node.wings.length; right += 1) {
        const wingA = node.wings[left]
        const wingB = node.wings[right]
        if (wingA === undefined || wingB === undefined) continue
        for (const hall of halls) edges.push({ room, wingA, wingB, hall, count: node.count })
      }
    }
  }
  return edges
}

function normalizeTunnels(parsed: ParsedBuildGraph): MultipassTunnelEdge[] {
  const unique = new Map<string, MultipassTunnelEdge>()
  for (const edge of parsed.edges) {
    const id = tunnelId(edge.room, edge.wingA, edge.wingB, edge.hall)
    unique.set(id, { id, room: edge.room, wingA: edge.wingA, wingB: edge.wingB, hall: edge.hall, count: edge.count })
  }
  return [...unique.values()].sort((left, right) => compareText(left.room, right.room)
    || compareText(left.wingA, right.wingA)
    || compareText(left.wingB, right.wingB)
    || compareText(left.hall, right.hall))
}

function normalizeRooms(parsed: ParsedBuildGraph, reachable: ReadonlySet<string>): MultipassRoomNode[] {
  return [...parsed.nodes.entries()].map(([room, data]): MultipassRoomNode => ({
    id: roomId(room),
    room,
    wings: data.wings,
    halls: data.halls,
    count: data.count,
    dates: data.dates,
    isolated: !reachable.has(room),
  })).sort((left, right) => compareText(left.room, right.room))
}

function normalizeWings(rooms: readonly MultipassRoomNode[], tunnels: readonly MultipassTunnelEdge[]): MultipassWingSummary[] {
  const wingRooms = new Map<string, { rooms: Set<string>; count: number }>()
  const connected = new Set<string>()
  for (const tunnel of tunnels) {
    connected.add(tunnel.wingA)
    connected.add(tunnel.wingB)
  }
  for (const room of rooms) {
    for (const wing of room.wings) {
      const summary = wingRooms.get(wing) ?? { rooms: new Set<string>(), count: 0 }
      summary.rooms.add(room.room)
      summary.count += room.count
      wingRooms.set(wing, summary)
    }
  }
  return [...wingRooms.entries()].map(([name, summary]): MultipassWingSummary => ({
    name,
    rooms: [...summary.rooms].sort(compareText),
    count: summary.count,
    isolated: !connected.has(name),
  })).sort((left, right) => compareText(left.name, right.name))
}

function buildPaths(nodes: ReadonlyMap<string, RawNodeData>, startRoom: string, maxHops: number): MultipassPathStep[] {
  if (!nodes.has(startRoom)) throw new Error(`mempalace_multipass: startRoom ${JSON.stringify(startRoom)} was not found in graph`)
  if (!Number.isSafeInteger(maxHops) || maxHops < 0) throw new Error('mempalace_multipass: maxHops must be a non-negative safe integer')
  const steps: MultipassPathStep[] = [{ room: startRoom, hop: 0, path: [startRoom], connectedVia: [] }]
  const visited = new Set([startRoom])
  const queue: MultipassPathStep[] = [steps[0] as MultipassPathStep]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || current.hop >= maxHops) continue
    const currentNode = nodes.get(current.room)
    if (currentNode === undefined) continue
    for (const [room, node] of nodes) {
      if (visited.has(room)) continue
      const connectedVia = node.wings.filter(wing => currentNode.wings.includes(wing)).sort(compareText)
      if (connectedVia.length === 0) continue
      const next: MultipassPathStep = {
        room,
        hop: current.hop + 1,
        path: [...current.path, room],
        connectedVia,
      }
      visited.add(room)
      steps.push(next)
      queue.push(next)
    }
  }
  return steps.sort((left, right) => left.hop - right.hop || compareText(left.room, right.room))
}

function reachableRooms(nodes: ReadonlyMap<string, RawNodeData>): ReadonlySet<string> {
  const reachable = new Set<string>()
  const entries = [...nodes.entries()]
  for (let i = 0; i < entries.length; i += 1) {
    const left = entries[i]
    if (left === undefined) continue
    for (let j = i + 1; j < entries.length; j += 1) {
      const right = entries[j]
      if (right === undefined) continue
      if (left[1].wings.some(wing => right[1].wings.includes(wing))) {
        reachable.add(left[0])
        reachable.add(right[0])
      }
    }
  }
  return reachable
}

function buildVisualization(
  rooms: readonly MultipassRoomNode[],
  wings: readonly MultipassWingSummary[],
  tunnels: readonly MultipassTunnelEdge[],
  paths: readonly MultipassPathStep[],
): MultipassVisualizationGraph {
  const nodes: MultipassVisualizationNode[] = []
  const links: MultipassVisualizationLink[] = []
  const allNodes = [
    ...wings.map(wing => ({ id: wingId(wing.name), kind: 'wing' as const, label: wing.name, group: 'wing' })),
    ...rooms.map(room => ({ id: room.id, kind: 'room' as const, label: room.room, group: room.halls[0] ?? 'room' })),
  ]
  for (let index = 0; index < allNodes.length; index += 1) {
    const node = allNodes[index]
    if (node !== undefined) nodes.push({ ...node, ...coordinate(index, allNodes.length) })
  }
  for (const room of rooms) {
    for (const wing of room.wings) links.push({ id: `placement:${encodeId(wing)}:${encodeId(room.room)}`, source: wingId(wing), target: room.id, kind: 'placement', room: room.room })
  }
  for (const tunnel of tunnels) links.push({ id: tunnel.id, source: wingId(tunnel.wingA), target: wingId(tunnel.wingB), kind: 'passive_tunnel', room: tunnel.room, hall: tunnel.hall })
  for (const step of paths) {
    if (step.path.length < 2) continue
    const previous = step.path[step.path.length - 2]
    if (previous === undefined) continue
    links.push({ id: `path:${encodeId(previous)}:${encodeId(step.room)}`, source: roomId(previous), target: roomId(step.room), kind: 'path', room: step.room })
  }
  return { nodes, links: links.sort((left, right) => compareText(left.id, right.id)) }
}

function coordinate(index: number, total: number): { readonly x: number; readonly y: number; readonly z: number } {
  const angle = index * 2.399963229728653
  const radius = 1 + (index % 11) / 10
  const z = total < 2 ? 0 : (index / (total - 1)) * 2 - 1
  return {
    x: Number((Math.cos(angle) * radius).toFixed(6)),
    y: Number((Math.sin(angle) * radius).toFixed(6)),
    z: Number(z.toFixed(6)),
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`mempalace_multipass: ${label} must be an object`)
  return value as Record<string, unknown>
}

function uniqueSortedStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`mempalace_multipass: ${label} must be an array`)
  const strings = value.map((item, index) => normalizeRequiredName(item, `${label}[${index}]`))
  return [...new Set(strings)].sort(compareText)
}

function normalizeRequiredName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`mempalace_multipass: ${label} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`mempalace_multipass: ${label} must not be blank`)
  return normalized
}

function normalizeOptionalName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return normalizeRequiredName(value, 'optional name')
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`mempalace_multipass: ${label} must be a non-negative safe integer`)
  return value
}

function roomId(room: string): string {
  return `room:${encodeId(room)}`
}

function wingId(wing: string): string {
  return `wing:${encodeId(wing)}`
}

function tunnelId(room: string, wingA: string, wingB: string, hall: string): string {
  return `tunnel:${encodeId(room)}:${encodeId(wingA)}:${encodeId(wingB)}:${encodeId(hall)}`
}

function encodeId(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en')
}
