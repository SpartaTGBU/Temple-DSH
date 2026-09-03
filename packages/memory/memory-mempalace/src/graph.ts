/** Validation and final bounding for MemPalace graph worker responses. */

import type {
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphRequest,
  MemoryGraphResult,
  MemoryGraphVisit,
} from '@deepseek-ai/dsh-memory'

/** Provider-side hard ceilings independent of any host request. */
export interface GraphLimits {
  readonly maxNodes: number
  readonly maxEdges: number
  readonly maxHops: number
  readonly maxBytes: number
}

/**
 * Validate a host request against provider ceilings.
 * @param request - Host-selected operation limits and optional start room.
 * @param limits - Provider hard ceilings that the request cannot exceed.
 */
export function validateGraphRequest(request: MemoryGraphRequest, limits: GraphLimits): void {
  positive('maxNodes', request.maxNodes, limits.maxNodes)
  positive('maxEdges', request.maxEdges, limits.maxEdges)
  positive('maxBytes', request.maxBytes, limits.maxBytes)
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops < 0 || request.maxHops > limits.maxHops) {
    throw new Error(`memory-mempalace: graph maxHops must be an integer from 0 to ${String(limits.maxHops)}`)
  }
  if (request.startRoom !== undefined && (request.startRoom.trim() !== request.startRoom || request.startRoom.length === 0 || utf8(request.startRoom) > 128)) {
    throw new Error('memory-mempalace: graph startRoom must be a trimmed non-empty string of at most 128 UTF-8 bytes')
  }
}

/**
 * Parse a hostile worker response and enforce complete-result bounds again.
 * @param raw - Untrusted JSON value returned by the worker protocol.
 * @param request - Host limits that apply to the complete result.
 * @param maxScanRecords - Provider ceiling for records inspected by the worker.
 * @returns Validated, deterministic provider-neutral graph data.
 */
export function parseGraphResult(raw: unknown, request: MemoryGraphRequest, maxScanRecords: number): MemoryGraphResult {
  const root = record(raw, 'graph result')
  if (root.format !== 'dsh.memory.graph.v1') throw new Error('memory-mempalace: graph response has an unsupported format')
  const rawNodes = array(root.nodes, 'graph nodes')
  const rawEdges = array(root.edges, 'graph edges')
  const rawVisits = array(root.visits, 'graph visits')
  if (rawNodes.length > request.maxNodes) throw new Error('memory-mempalace: graph response exceeded maxNodes')
  if (rawEdges.length > request.maxEdges) throw new Error('memory-mempalace: graph response exceeded maxEdges')

  const nodes = rawNodes.map(parseNode).sort(byId)
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  if (nodeById.size !== nodes.length) throw new Error('memory-mempalace: graph response contains duplicate node ids')
  const edges = rawEdges.map(parseEdge).sort(byId)
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error('memory-mempalace: graph response contains duplicate edge ids')
    edgeIds.add(edge.id)
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) throw new Error('memory-mempalace: graph edge references an unknown node')
    validateEdgeTopology(edge, nodeById)
  }
  const visits = rawVisits.map(value => parseVisit(value, nodeById, request.maxHops))
    .sort((left, right) => left.hop - right.hop || compare(left.nodeId, right.nodeId))
  if (new Set(visits.map(visit => visit.nodeId)).size !== visits.length) throw new Error('memory-mempalace: graph response contains duplicate visits')
  const truncated = boolean(root.truncated, 'graph truncated')
  validateTraversal(visits, nodeById, request.startRoom, truncated)

  const statsRecord = record(root.stats, 'graph stats')
  const scannedRecords = nonNegative(statsRecord.scannedRecords, 'graph scannedRecords')
  if (scannedRecords > maxScanRecords) throw new Error('memory-mempalace: graph scannedRecords exceeded the provider limit')
  const maxHop = visits.reduce((maximum, visit) => Math.max(maximum, visit.hop), 0)
  exactStat(statsRecord.nodeCount, nodes.length, 'nodeCount')
  exactStat(statsRecord.edgeCount, edges.length, 'edgeCount')
  exactStat(statsRecord.maxHop, maxHop, 'maxHop')
  const result: MemoryGraphResult = {
    format: 'dsh.memory.graph.v1',
    backend: 'mempalace',
    nodes,
    edges,
    visits,
    truncated,
    stats: { scannedRecords, nodeCount: nodes.length, edgeCount: edges.length, maxHop },
  }
  if (utf8(JSON.stringify(result)) > request.maxBytes) throw new Error('memory-mempalace: graph response exceeded maxBytes')
  return result
}

function parseNode(value: unknown): MemoryGraphNode {
  const item = record(value, 'graph node')
  const kind = item.kind
  if (kind !== 'room' && kind !== 'wing') throw new Error('memory-mempalace: graph node kind is invalid')
  return {
    id: boundedString(item.id, 'graph node id'),
    kind,
    label: boundedString(item.label, 'graph node label'),
    count: positiveValue(item.count, 'graph node count'),
    isolated: boolean(item.isolated, 'graph node isolated'),
  }
}

function parseEdge(value: unknown): MemoryGraphEdge {
  const item = record(value, 'graph edge')
  const kind = item.kind
  if (kind !== 'placement' && kind !== 'tunnel' && kind !== 'path') throw new Error('memory-mempalace: graph edge kind is invalid')
  return {
    id: boundedString(item.id, 'graph edge id'),
    source: boundedString(item.source, 'graph edge source'),
    target: boundedString(item.target, 'graph edge target'),
    kind,
    count: positiveValue(item.count, 'graph edge count'),
  }
}

function parseVisit(value: unknown, nodes: ReadonlyMap<string, MemoryGraphNode>, maxHops: number): MemoryGraphVisit {
  const item = record(value, 'graph visit')
  const nodeId = boundedString(item.nodeId, 'graph visit nodeId')
  const hop = nonNegative(item.hop, 'graph visit hop')
  if (hop > maxHops || nodes.get(nodeId)?.kind !== 'room') throw new Error('memory-mempalace: graph visit is outside the requested room graph')
  const parentNodeId = item.parentNodeId === undefined ? undefined : boundedString(item.parentNodeId, 'graph visit parentNodeId')
  if (parentNodeId !== undefined && nodes.get(parentNodeId)?.kind !== 'room') throw new Error('memory-mempalace: graph visit parent is unknown')
  const via = array(item.via, 'graph visit via').map(value => boundedString(value, 'graph visit via item')).sort(compare)
  if (new Set(via).size !== via.length) throw new Error('memory-mempalace: graph visit contains duplicate via labels')
  return { nodeId, hop, ...(parentNodeId === undefined ? {} : { parentNodeId }), via }
}

function validateEdgeTopology(edge: MemoryGraphEdge, nodes: ReadonlyMap<string, MemoryGraphNode>): void {
  const source = nodes.get(edge.source)!
  const target = nodes.get(edge.target)!
  if (edge.source === edge.target) throw new Error('memory-mempalace: graph edge cannot reference itself')
  const valid = edge.kind === 'placement'
    ? source.kind === 'wing' && target.kind === 'room'
    : edge.kind === 'tunnel'
      ? source.kind === 'wing' && target.kind === 'wing'
      : source.kind === 'room' && target.kind === 'room'
  if (!valid) throw new Error(`memory-mempalace: graph ${edge.kind} edge has invalid endpoint kinds`)
}

function validateTraversal(visits: readonly MemoryGraphVisit[], nodes: ReadonlyMap<string, MemoryGraphNode>, startRoom: string | undefined, truncated: boolean): void {
  if (startRoom === undefined) {
    if (visits.length > 0) throw new Error('memory-mempalace: graph response contains visits without a startRoom')
    return
  }
  if (visits.length === 0 && truncated) return
  const byNode = new Map(visits.map(visit => [visit.nodeId, visit]))
  const roots = visits.filter(visit => visit.hop === 0)
  if (roots.length !== 1 || nodes.get(roots[0]!.nodeId)?.label !== startRoom || roots[0]!.parentNodeId !== undefined || roots[0]!.via.length !== 0) {
    throw new Error('memory-mempalace: graph traversal root does not match startRoom')
  }
  for (const visit of visits) {
    if (visit.hop === 0) continue
    const parent = visit.parentNodeId === undefined ? undefined : byNode.get(visit.parentNodeId)
    if (parent === undefined || parent.hop !== visit.hop - 1 || visit.via.length === 0) {
      throw new Error('memory-mempalace: graph traversal parent chain is invalid')
    }
  }
}

function positive(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`memory-mempalace: graph ${name} must be an integer from 1 to ${String(maximum)}`)
  }
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`memory-mempalace: ${label} must be a non-negative integer`)
  return value
}

function positiveValue(value: unknown, label: string): number {
  const parsed = nonNegative(value, label)
  if (parsed === 0) throw new Error(`memory-mempalace: ${label} must be a positive integer`)
  return parsed
}

function exactStat(value: unknown, expected: number, label: string): void {
  if (nonNegative(value, `graph ${label}`) !== expected) throw new Error(`memory-mempalace: graph ${label} does not match the result`)
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || utf8(value) > 512) throw new Error(`memory-mempalace: ${label} must be a non-empty bounded string`)
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`memory-mempalace: ${label} must be boolean`)
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`memory-mempalace: ${label} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`memory-mempalace: ${label} must be an array`)
  return value
}

function utf8(value: string): number { return new TextEncoder().encode(value).byteLength }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function byId(left: { readonly id: string }, right: { readonly id: string }): number { return compare(left.id, right.id) }
