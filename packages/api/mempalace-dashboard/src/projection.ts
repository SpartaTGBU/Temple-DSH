/** Read-only MemPalace dashboard projection over local persisted files. */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryInspectionSource, MemoryStatus } from '@deepseek-ai/dsh-memory'
import type {
  MemPalaceDashboardRequest,
  MemPalaceDashboardSnapshot,
  MemPalaceDrawerView,
  MemPalaceHealthView,
  MemPalaceKnowledgeFactView,
  MemPalaceKnowledgeGraphView,
  MemPalaceLocationView,
  MemPalaceProviderStatusView,
  MemPalaceRoomView,
  MemPalaceSection,
  MemPalaceStructureView,
  MemPalaceTunnelView,
  MemPalaceUnavailable,
  MemPalaceWingView,
} from './types.ts'

const DEFAULT_COLLECTION_NAME = 'mempalace_drawers'
const DEFAULT_BACKEND = 'chroma'
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const MAX_GROUPS = 1000
const MAX_CONFIG_BYTES = 64 * 1024
const MAX_TUNNELS_BYTES = 1024 * 1024

/** Filesystem and environment dependencies for deterministic projection tests. */
export interface MemPalaceProjectionOptions {
  /** Account home that contains `.mempalace` unless overridden. */
  readonly home?: string
  /** Environment values used for MemPalace overrides. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Direct config file override for tests or profile patches. */
  readonly configPath?: string
  /** Direct palace path override for standalone tests. */
  readonly palacePath?: string
  /** Provider-resolved coordinates; authoritative when present. */
  readonly source?: MemoryInspectionSource
  /** Safe provider status facts copied without the free-form detail field. */
  readonly providerStatus?: MemoryStatus
  /** Maximum drawers and facts returned when the request omits a limit. */
  readonly defaultLimit?: number
}

interface NormalizedRequest {
  readonly wing?: string
  readonly room?: string
  readonly query?: string
  readonly limit: number
}

interface ResolvedConfig {
  readonly location: MemPalaceLocationView
}

interface GroupRow {
  readonly wing: string
  readonly room: string
  readonly hall: string
  readonly drawerCount: number
  readonly latestDate?: string
}

interface SqliteDriver {
  readonly grouped: string
  readonly drawers: string
}

const CHROMA_DRIVER: SqliteDriver = {
  grouped: `
    SELECT
      COALESCE(wm.string_value, CAST(wm.int_value AS TEXT), CAST(wm.float_value AS TEXT), '') AS wing,
      COALESCE(rm.string_value, CAST(rm.int_value AS TEXT), CAST(rm.float_value AS TEXT), '') AS room,
      COALESCE(hm.string_value, CAST(hm.int_value AS TEXT), CAST(hm.float_value AS TEXT), '') AS hall,
      COUNT(*) AS drawerCount,
      COALESCE(MAX(dm.string_value), '') AS latestDate
    FROM embeddings e
    JOIN segments s ON e.segment_id = s.id AND s.scope = 'METADATA'
    JOIN collections c ON s.collection = c.id
    LEFT JOIN embedding_metadata wm ON wm.id = e.id AND wm.key = 'wing'
    LEFT JOIN embedding_metadata rm ON rm.id = e.id AND rm.key = 'room'
    LEFT JOIN embedding_metadata hm ON hm.id = e.id AND hm.key = 'hall'
    LEFT JOIN embedding_metadata dm ON dm.id = e.id AND dm.key = 'date'
    WHERE c.name = ?
    GROUP BY wing, room, hall
    ORDER BY drawerCount DESC, wing, room
    LIMIT ?
  `,
  drawers: `
    SELECT
      e.embedding_id AS id,
      COALESCE(wm.string_value, CAST(wm.int_value AS TEXT), CAST(wm.float_value AS TEXT), '') AS wing,
      COALESCE(rm.string_value, CAST(rm.int_value AS TEXT), CAST(rm.float_value AS TEXT), '') AS room,
      COALESCE(hm.string_value, CAST(hm.int_value AS TEXT), CAST(hm.float_value AS TEXT), '') AS hall,
      COALESCE(sm.string_value, CAST(sm.int_value AS TEXT), CAST(sm.float_value AS TEXT), '') AS sourceFile,
      COALESCE(dm.string_value, '') AS date,
      COALESCE(doc.string_value, '') AS document
    FROM embeddings e
    JOIN segments s ON e.segment_id = s.id AND s.scope = 'METADATA'
    JOIN collections c ON s.collection = c.id
    LEFT JOIN embedding_metadata wm ON wm.id = e.id AND wm.key = 'wing'
    LEFT JOIN embedding_metadata rm ON rm.id = e.id AND rm.key = 'room'
    LEFT JOIN embedding_metadata hm ON hm.id = e.id AND hm.key = 'hall'
    LEFT JOIN embedding_metadata sm ON sm.id = e.id AND sm.key = 'source_file'
    LEFT JOIN embedding_metadata dm ON dm.id = e.id AND dm.key = 'date'
    LEFT JOIN embedding_metadata doc ON doc.id = e.id AND doc.key = 'chroma:document'
    WHERE c.name = ?
      AND (? IS NULL OR wing = ?)
      AND (? IS NULL OR room = ?)
      AND (? IS NULL OR lower(document) LIKE ? OR lower(sourceFile) LIKE ? OR lower(e.embedding_id) LIKE ?)
    ORDER BY e.id DESC
    LIMIT ?
  `,
}

const SQLITE_EXACT_DRIVER: SqliteDriver = {
  grouped: `
    SELECT
      COALESCE(wing, json_extract(metadata_json, '$.wing'), '') AS wing,
      COALESCE(room, json_extract(metadata_json, '$.room'), '') AS room,
      COALESCE(hall, json_extract(metadata_json, '$.hall'), '') AS hall,
      COUNT(*) AS drawerCount,
      COALESCE(MAX(json_extract(metadata_json, '$.date')), '') AS latestDate
    FROM documents d
    JOIN collections c ON d.collection_id = c.id
    WHERE c.name = ?
    GROUP BY wing, room, hall
    ORDER BY drawerCount DESC, wing, room
    LIMIT ?
  `,
  drawers: `
    SELECT
      d.id,
      COALESCE(wing, json_extract(metadata_json, '$.wing'), '') AS wing,
      COALESCE(room, json_extract(metadata_json, '$.room'), '') AS room,
      COALESCE(hall, json_extract(metadata_json, '$.hall'), '') AS hall,
      COALESCE(json_extract(metadata_json, '$.source_file'), '') AS sourceFile,
      COALESCE(json_extract(metadata_json, '$.date'), '') AS date,
      d.document AS document
    FROM documents d
    JOIN collections c ON d.collection_id = c.id
    WHERE c.name = ?
      AND (? IS NULL OR wing = ?)
      AND (? IS NULL OR room = ?)
      AND (? IS NULL OR lower(d.document) LIKE ? OR lower(sourceFile) LIKE ? OR lower(d.id) LIKE ?)
    ORDER BY d.rowid DESC
    LIMIT ?
  `,
}

/**
 * Build one read-only dashboard snapshot from MemPalace persisted files.
 * @param request - normalized by this function before filesystem reads.
 * @param options - host/test dependency overrides.
 * @returns the available sections plus explicit unavailable states.
 */
export function buildMemPalaceDashboard(
  request: MemPalaceDashboardRequest = {},
  options: MemPalaceProjectionOptions = {},
): MemPalaceDashboardSnapshot {
  const filters = normalizeRequest(request, options.defaultLimit)
  const { location } = resolveConfig(options)
  const structure = readStructure(location, filters)
  const knowledgeGraph = readKnowledgeGraph(location, filters.limit)
  const health = projectHealth(structure, knowledgeGraph)
  return {
    generatedAt: new Date().toISOString(),
    provider: providerView(options.providerStatus),
    location: { available: true, value: location },
    filters,
    structure,
    knowledgeGraph,
    health,
    retrievalTransparency: unavailable(
      'retrieval-traces-not-persisted',
      'MemPalace does not persist per-answer retrieval traces or model-context snapshots in the inspected files.',
    ),
  }
}

/**
 * Build a complete unavailable snapshot when the configured provider cannot identify storage.
 * @param request - raw bounded filter request.
 * @param reason - provider availability reason.
 * @param message - safe user-facing diagnostic.
 * @returns a snapshot with no inferred location or persisted values.
 */
export function unavailableMemPalaceDashboard(
  request: MemPalaceDashboardRequest,
  reason: 'memory-provider-not-found' | 'memory-provider-unsupported' | 'memory-provider-unavailable',
  message: string,
): MemPalaceDashboardSnapshot {
  const section = unavailable(reason, message)
  return {
    generatedAt: new Date().toISOString(),
    provider: section,
    location: section,
    filters: normalizeRequest(request),
    structure: section,
    knowledgeGraph: section,
    health: section,
    retrievalTransparency: unavailable(
      'retrieval-traces-not-persisted',
      'MemPalace does not persist per-answer retrieval traces or model-context snapshots in the inspected files.',
    ),
  }
}

/**
 * Normalize optional filters for stable matching and safe bounded reads.
 * @param request - raw request payload.
 * @param defaultLimit - fallback limit before clamping.
 * @returns filters with blank strings removed and limit clamped to 1..100.
 */
export function normalizeRequest(
  request: MemPalaceDashboardRequest,
  defaultLimit = DEFAULT_LIMIT,
): NormalizedRequest {
  const limit = clampLimit(request.limit, defaultLimit)
  const wing = normalizedString(request.wing)
  const room = normalizedString(request.room)
  const query = normalizedString(request.query)
  return {
    ...(wing === undefined ? {} : { wing }),
    ...(room === undefined ? {} : { room }),
    ...(query === undefined ? {} : { query }),
    limit,
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  const raw = Number.isInteger(value) ? value : fallback
  return Math.max(1, Math.min(MAX_LIMIT, raw ?? DEFAULT_LIMIT))
}

function normalizedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function resolveConfig(options: MemPalaceProjectionOptions): ResolvedConfig {
  if (options.source !== undefined) {
    return {
      location: {
        palacePath: resolve(options.source.palacePath),
        collectionName: options.source.collectionName,
        backend: options.source.storageBackend.trim().toLowerCase(),
        wing: options.source.wing,
        authority: 'memory-provider',
      },
    }
  }
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const configPath = resolve(options.configPath ?? join(home, '.mempalace', 'config.json'))
  const fileConfig = readJsonObject(configPath, MAX_CONFIG_BYTES)
  const palacePath = resolve(
    options.palacePath
      ?? env.MEMPALACE_PALACE_PATH
      ?? env.MEMPAL_PALACE_PATH
      ?? stringValue(fileConfig['palace_path'])
      ?? join(home, '.mempalace', 'palace'),
  )
  const collectionName = stringValue(fileConfig['collection_name']) ?? DEFAULT_COLLECTION_NAME
  const backend = (
    stringValue(fileConfig['backend'])
    ?? env.MEMPALACE_BACKEND
    ?? detectBackend(palacePath)
    ?? DEFAULT_BACKEND
  ).trim().toLowerCase()
  return {
    location: {
      palacePath,
      collectionName,
      backend,
      wing: env.MEMPALACE_WING ?? 'wing_general',
      authority: 'standalone-projection',
    },
  }
}

function readJsonObject(path: string, maxBytes: number): Record<string, unknown> {
  try {
    if (statSync(path).size > maxBytes) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function detectBackend(palacePath: string): string | undefined {
  if (existsSync(join(palacePath, 'chroma.sqlite3'))) return 'chroma'
  if (existsSync(join(palacePath, 'sqlite_exact.sqlite3'))) return 'sqlite_exact'
  return undefined
}

function readStructure(
  location: MemPalaceLocationView,
  filters: NormalizedRequest,
): MemPalaceSection<MemPalaceStructureView> {
  if (!existsSync(location.palacePath)) {
    return unavailable('palace-not-found', `MemPalace palace path does not exist: ${location.palacePath}`)
  }
  const dbInfo = drawerDatabase(location)
  if (dbInfo === undefined) {
    return unavailable('drawer-index-not-found', 'No readable MemPalace drawer index was found for the configured backend.')
  }
  if (dbInfo === null) {
    return unavailable('unsupported-backend', `Dashboard projection supports chroma and sqlite_exact, not ${location.backend}.`)
  }
  try {
    const db = new DatabaseSync(dbInfo.path, { readOnly: true })
    try {
      db.exec('PRAGMA query_only = ON')
      db.exec('PRAGMA busy_timeout = 2000')
      const rooms = rowsOf<GroupRow>(db.prepare(dbInfo.driver.grouped).all(location.collectionName, MAX_GROUPS))
        .filter(row => row.wing.length > 0 && row.room.length > 0)
        .sort((a, b) => b.drawerCount - a.drawerCount || a.wing.localeCompare(b.wing) || a.room.localeCompare(b.room))
      const drawers = rowsOf<DrawerSqlRow>(db.prepare(dbInfo.driver.drawers).all(
        location.collectionName,
        filters.wing ?? null,
        filters.wing ?? null,
        filters.room ?? null,
        filters.room ?? null,
        filters.query?.toLocaleLowerCase() ?? null,
        filters.query === undefined ? null : `%${filters.query.toLocaleLowerCase()}%`,
        filters.query === undefined ? null : `%${filters.query.toLocaleLowerCase()}%`,
        filters.query === undefined ? null : `%${filters.query.toLocaleLowerCase()}%`,
        filters.limit,
      )).map(drawerView)
      return {
        available: true,
        value: {
          wings: wingViews(rooms),
          rooms,
          drawers,
          tunnels: readTunnels(location, rooms),
        },
      }
    } finally {
      db.close()
    }
  } catch (error) {
    return unavailable('sqlite-read-failed', `MemPalace drawer index could not be read: ${errorMessage(error)}`)
  }
}

interface DrawerDbInfo {
  readonly path: string
  readonly driver: SqliteDriver
}

function drawerDatabase(location: MemPalaceLocationView): DrawerDbInfo | null | undefined {
  if (location.backend === 'chroma') {
    const path = join(location.palacePath, 'chroma.sqlite3')
    return existsSync(path) ? { path, driver: CHROMA_DRIVER } : undefined
  }
  if (location.backend === 'sqlite_exact') {
    const path = join(location.palacePath, 'sqlite_exact.sqlite3')
    return existsSync(path) ? { path, driver: SQLITE_EXACT_DRIVER } : undefined
  }
  return null
}

function rowsOf<T>(rows: unknown[]): T[] {
  return rows.map(row => row as T)
}

interface DrawerSqlRow {
  readonly id: string
  readonly wing: string
  readonly room: string
  readonly hall: string
  readonly sourceFile: string
  readonly date: string
  readonly document: string
}

function drawerView(row: DrawerSqlRow): MemPalaceDrawerView {
  return {
    id: String(row.id),
    wing: row.wing,
    room: row.room,
    hall: row.hall,
    ...(row.sourceFile.length === 0 ? {} : { sourceFile: row.sourceFile }),
    ...(row.date.length === 0 ? {} : { date: row.date }),
    preview: row.document.slice(0, 500),
  }
}

function wingViews(rooms: readonly MemPalaceRoomView[]): MemPalaceWingView[] {
  const byWing = new Map<string, { drawerCount: number; roomCount: number }>()
  for (const room of rooms) {
    const current = byWing.get(room.wing) ?? { drawerCount: 0, roomCount: 0 }
    current.drawerCount += room.drawerCount
    current.roomCount += 1
    byWing.set(room.wing, current)
  }
  return [...byWing].map(([wing, value]) => ({ wing, ...value }))
    .sort((a, b) => b.drawerCount - a.drawerCount || a.wing.localeCompare(b.wing))
}

function readTunnels(
  location: MemPalaceLocationView,
  rooms: readonly MemPalaceRoomView[],
): MemPalaceSection<readonly MemPalaceTunnelView[]> {
  const passive = passiveTunnels(rooms)
  const tunnelPath = join(dirname(location.palacePath), 'tunnels.json')
  if (!existsSync(tunnelPath)) {
    return passive.length === 0
      ? unavailable('tunnels-not-found', 'No MemPalace tunnels.json sidecar exists, and no passive cross-wing room tunnels were found.')
      : { available: true, value: passive }
  }
  const explicitRows = readJsonArray(tunnelPath, MAX_TUNNELS_BYTES)
  if (explicitRows === undefined) {
    return unavailable('sidecar-read-failed', 'MemPalace tunnels.json is invalid or exceeds the inspection size limit.')
  }
  const explicit = explicitRows.map(explicitTunnel).filter(tunnel => tunnel !== undefined)
  return { available: true, value: [...passive, ...explicit] }
}

function passiveTunnels(rooms: readonly MemPalaceRoomView[]): MemPalaceTunnelView[] {
  const byRoom = new Map<string, MemPalaceRoomView[]>()
  for (const room of rooms) {
    byRoom.set(room.room, [...byRoom.get(room.room) ?? [], room])
  }
  const tunnels: MemPalaceTunnelView[] = []
  for (const [roomName, entries] of byRoom) {
    const wings = [...new Set(entries.map(entry => entry.wing))].sort()
    if (wings.length < 2) continue
    for (let i = 0; i < wings.length; i += 1) {
      for (let j = i + 1; j < wings.length; j += 1) {
        tunnels.push({
          id: `passive:${wings[i]}:${wings[j]}:${roomName}`,
          kind: 'passive',
          sourceWing: wings[i] ?? '',
          sourceRoom: roomName,
          targetWing: wings[j] ?? '',
          targetRoom: roomName,
          drawerCount: entries.reduce((sum, entry) => sum + entry.drawerCount, 0),
        })
      }
    }
  }
  return tunnels
}

function readJsonArray(path: string, maxBytes: number): unknown[] | undefined {
  try {
    if (statSync(path).size > maxBytes) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function explicitTunnel(value: unknown): MemPalaceTunnelView | undefined {
  if (!isRecord(value)) return undefined
  const source = isRecord(value.source) ? value.source : {}
  const target = isRecord(value.target) ? value.target : {}
  const sourceWing = stringValue(source.wing)
  const sourceRoom = stringValue(source.room)
  const targetWing = stringValue(target.wing)
  const targetRoom = stringValue(target.room)
  if (sourceWing === undefined || sourceRoom === undefined || targetWing === undefined || targetRoom === undefined) {
    return undefined
  }
  const kind = tunnelKind(stringValue(value.kind))
  const label = stringValue(value.label)
  const updatedAt = stringValue(value.updated_at) ?? stringValue(value.created_at)
  return {
    id: stringValue(value.id) ?? `${sourceWing}:${sourceRoom}:${targetWing}:${targetRoom}`,
    kind,
    sourceWing,
    sourceRoom,
    targetWing,
    targetRoom,
    ...(label === undefined ? {} : { label }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function tunnelKind(value: string | undefined): MemPalaceTunnelView['kind'] {
  if (value === 'explicit' || value === 'topic' || value === 'entity') return value
  return 'unknown'
}

function readKnowledgeGraph(
  location: MemPalaceLocationView,
  limit: number,
): MemPalaceSection<MemPalaceKnowledgeGraphView> {
  const path = join(dirname(location.palacePath), 'knowledge_graph.sqlite3')
  if (!existsSync(path)) return unavailable('knowledge-graph-not-found', 'MemPalace knowledge_graph.sqlite3 was not found beside the palace.')
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      db.exec('PRAGMA query_only = ON')
      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM entities) AS entities,
          (SELECT COUNT(*) FROM triples) AS facts,
          (SELECT COUNT(*) FROM triples WHERE valid_to IS NULL) AS currentFacts
      `).get() as { entities: number; facts: number; currentFacts: number }
      const relationshipTypes = rowsOf<{ predicate: string }>(db.prepare(
        'SELECT DISTINCT predicate FROM triples ORDER BY predicate LIMIT 100',
      ).all()).map(row => row.predicate)
      const timeline = rowsOf<KgSqlRow>(db.prepare(`
        SELECT t.id, s.name AS subject, t.predicate, o.name AS object,
          t.valid_from AS validFrom, t.valid_to AS validTo, t.confidence,
          t.source_file AS sourceFile, t.source_drawer_id AS sourceDrawerId,
          t.extracted_at AS extractedAt
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        ORDER BY COALESCE(t.valid_from, t.extracted_at, '') DESC, t.id DESC
        LIMIT ?
      `).all(limit)).map(kgFactView)
      return {
        available: true,
        value: {
          entities: stats.entities,
          facts: stats.facts,
          currentFacts: stats.currentFacts,
          expiredFacts: stats.facts - stats.currentFacts,
          relationshipTypes,
          timeline,
        },
      }
    } finally {
      db.close()
    }
  } catch (error) {
    return unavailable('sqlite-read-failed', `MemPalace knowledge graph could not be read: ${errorMessage(error)}`)
  }
}

interface KgSqlRow {
  readonly id: string
  readonly subject: string
  readonly predicate: string
  readonly object: string
  readonly validFrom: string | null
  readonly validTo: string | null
  readonly confidence: number | null
  readonly sourceFile: string | null
  readonly sourceDrawerId: string | null
  readonly extractedAt: string | null
}

function kgFactView(row: KgSqlRow): MemPalaceKnowledgeFactView {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    current: row.validTo === null,
    ...(row.validFrom === null ? {} : { validFrom: row.validFrom }),
    ...(row.validTo === null ? {} : { validTo: row.validTo }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    ...(row.sourceFile === null ? {} : { sourceFile: row.sourceFile }),
    ...(row.sourceDrawerId === null ? {} : { sourceDrawerId: row.sourceDrawerId }),
    ...(row.extractedAt === null ? {} : { extractedAt: row.extractedAt }),
  }
}

function projectHealth(
  structure: MemPalaceSection<MemPalaceStructureView>,
  knowledgeGraph: MemPalaceSection<MemPalaceKnowledgeGraphView>,
): MemPalaceSection<MemPalaceHealthView> {
  if (!structure.available) return structure
  const value: MemPalaceHealthView = {
    drawerCount: structure.value.wings.reduce((sum, wing) => sum + wing.drawerCount, 0),
    wingCount: structure.value.wings.length,
    roomCount: structure.value.rooms.length,
    currentFactCount: knowledgeGraph.available ? knowledgeGraph.value.currentFacts : null,
    expiredFactCount: knowledgeGraph.available ? knowledgeGraph.value.expiredFacts : null,
    unavailableSignals: [
      unavailable(
        'memory-health-not-persisted',
        'Duplicate, stale-memory, contradiction, and orphan-health scans are maintenance jobs; their results are not persisted in the inspected MemPalace files.',
      ),
      ...knowledgeGraph.available ? [] : [knowledgeGraph],
    ],
  }
  return { available: true, value }
}

function providerView(status: MemoryStatus | undefined): MemPalaceSection<MemPalaceProviderStatusView> {
  if (status === undefined) {
    return unavailable('memory-provider-unsupported', 'This standalone projection was not resolved through ctx.memory.')
  }
  return {
    available: true,
    value: {
      state: status.state,
      backend: status.backend,
      pendingCaptures: status.pendingCaptures,
      workerStarts: status.workerStarts,
    },
  }
}

function unavailable(reason: MemPalaceUnavailable['reason'], message: string): MemPalaceUnavailable {
  return { available: false, reason, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
