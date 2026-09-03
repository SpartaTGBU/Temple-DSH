import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMemPalaceDashboard, normalizeRequest } from '../src/projection.ts'

const roots: string[] = []

function root(): string {
  const path = join(tmpdir(), `dsh-mempalace-dashboard-${process.pid}-${roots.length}`)
  rmSync(path, { recursive: true, force: true })
  mkdirSync(path, { recursive: true })
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

function seedSqliteExact(palacePath: string): void {
  mkdirSync(palacePath, { recursive: true })
  const db = new DatabaseSync(join(palacePath, 'sqlite_exact.sqlite3'))
  db.exec(`
    CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      collection_id INTEGER NOT NULL,
      document TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      wing TEXT,
      room TEXT,
      hall TEXT
    );
    INSERT INTO collections (id, name) VALUES (1, 'mempalace_drawers');
    INSERT INTO documents VALUES
      ('drawer-a', 1, 'alpha continuity note', '{"source_file":"a.md","date":"2026-01-02"}', 'wing_alpha', 'room_shared', 'technical'),
      ('drawer-b', 1, 'beta unrelated note', '{"source_file":"b.md","date":"2026-01-03"}', 'wing_beta', 'room_shared', 'technical'),
      ('drawer-c', 1, 'alpha filtered health', '{"source_file":"c.md","date":"2026-01-04"}', 'wing_alpha', 'room_private', 'memory');
  `)
  db.close()
}

function seedKnowledgeGraph(home: string): void {
  const db = new DatabaseSync(join(home, 'knowledge_graph.sqlite3'))
  db.exec(`
    CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'unknown', properties TEXT DEFAULT '{}');
    CREATE TABLE triples (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      confidence REAL DEFAULT 1.0,
      source_closet TEXT,
      source_file TEXT,
      source_drawer_id TEXT,
      adapter_name TEXT,
      extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO entities (id, name) VALUES ('alice', 'Alice'), ('dsh', 'DSH');
    INSERT INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_file, source_drawer_id, extracted_at)
      VALUES ('fact-1', 'alice', 'works_on', 'dsh', '2026-01-01', NULL, 0.9, 'a.md', 'drawer-a', '2026-01-05T00:00:00Z');
  `)
  db.close()
}

describe('MemPalace dashboard projection', () => {
  it('normalizes blank filters and clamps limits', () => {
    expect(normalizeRequest({ wing: '  ', room: ' room ', query: ' alpha ', limit: 500 })).toEqual({
      room: 'room',
      query: 'alpha',
      limit: 100,
    })
    expect(normalizeRequest({ limit: 0 })).toEqual({ limit: 1 })
  })

  it('projects sqlite_exact drawers, KG facts, passive tunnels, explicit tunnels, and unavailable traces', () => {
    const home = root()
    const palacePath = join(home, 'palace')
    seedSqliteExact(palacePath)
    seedKnowledgeGraph(home)
    writeFileSync(join(home, 'tunnels.json'), JSON.stringify([
      {
        id: 'explicit-1',
        kind: 'explicit',
        source: { wing: 'wing_alpha', room: 'room_private', drawer_id: 'drawer-c' },
        target: { wing: 'wing_beta', room: 'room_shared' },
        label: 'related work',
        updated_at: '2026-01-06T00:00:00Z',
      },
    ]))

    const snapshot = buildMemPalaceDashboard({ wing: 'wing_alpha', query: 'health', limit: 10 }, {
      home,
      palacePath,
      env: {},
    })

    expect(snapshot.provider).toMatchObject({ available: false, reason: 'memory-provider-unsupported' })
    expect(snapshot.location).toMatchObject({
      available: true,
      value: { palacePath, backend: 'sqlite_exact', wing: 'wing_general', authority: 'standalone-projection' },
    })
    expect(snapshot.structure.available).toBe(true)
    if (!snapshot.structure.available) throw new Error(snapshot.structure.message)
    expect(snapshot.structure.value.wings).toEqual([
      { wing: 'wing_alpha', drawerCount: 2, roomCount: 2 },
      { wing: 'wing_beta', drawerCount: 1, roomCount: 1 },
    ])
    expect(snapshot.structure.value.drawers.map(drawer => drawer.id)).toEqual(['drawer-c'])
    expect(snapshot.structure.value.tunnels.available).toBe(true)
    if (!snapshot.structure.value.tunnels.available) throw new Error(snapshot.structure.value.tunnels.message)
    expect(snapshot.structure.value.tunnels.value.map(tunnel => tunnel.kind)).toEqual(['passive', 'explicit'])
    expect(snapshot.knowledgeGraph.available).toBe(true)
    if (!snapshot.knowledgeGraph.available) throw new Error(snapshot.knowledgeGraph.message)
    expect(snapshot.knowledgeGraph.value).toMatchObject({ entities: 2, facts: 1, currentFacts: 1, expiredFacts: 0 })
    expect(snapshot.knowledgeGraph.value.timeline[0]).toMatchObject({ id: 'fact-1', subject: 'Alice', object: 'DSH' })
    expect(snapshot.health.available).toBe(true)
    if (!snapshot.health.available) throw new Error(snapshot.health.message)
    expect(snapshot.health.value.unavailableSignals.map(signal => signal.reason)).toEqual(['memory-health-not-persisted'])
    expect(snapshot.retrievalTransparency).toMatchObject({ available: false, reason: 'retrieval-traces-not-persisted' })
  })

  it('reports explicit unavailable states instead of fabricating missing data', () => {
    const home = root()
    const palacePath = join(home, 'missing-palace')
    const missing = buildMemPalaceDashboard({}, { home, palacePath, env: {} })
    expect(missing.structure).toMatchObject({ available: false, reason: 'palace-not-found' })
    expect(missing.health).toMatchObject({ available: false, reason: 'palace-not-found' })

    mkdirSync(palacePath)
    const unsupported = buildMemPalaceDashboard({}, {
      home,
      palacePath,
      env: { MEMPALACE_BACKEND: 'qdrant' },
    })
    expect(unsupported.structure).toMatchObject({ available: false, reason: 'unsupported-backend' })
    expect(unsupported.knowledgeGraph).toMatchObject({ available: false, reason: 'knowledge-graph-not-found' })
  })

  it('uses provider-resolved storage coordinates instead of divergent environment and file values', () => {
    const home = root()
    const palacePath = join(home, 'provider-palace')
    seedSqliteExact(palacePath)
    const snapshot = buildMemPalaceDashboard({}, {
      home,
      palacePath: join(home, 'wrong-option'),
      env: { MEMPALACE_PALACE_PATH: join(home, 'wrong-env'), MEMPALACE_BACKEND: 'qdrant' },
      source: {
        kind: 'mempalace',
        palacePath,
        collectionName: 'mempalace_drawers',
        storageBackend: 'sqlite_exact',
        wing: 'wing_native',
      },
      providerStatus: {
        state: 'degraded',
        backend: 'mempalace',
        detail: 'must not be projected',
        pendingCaptures: 4,
        workerStarts: 2,
      },
    })
    expect(snapshot.location).toEqual({
      available: true,
      value: {
        palacePath,
        collectionName: 'mempalace_drawers',
        backend: 'sqlite_exact',
        wing: 'wing_native',
        authority: 'memory-provider',
      },
    })
    expect(snapshot.provider).toEqual({
      available: true,
      value: { state: 'degraded', backend: 'mempalace', pendingCaptures: 4, workerStarts: 2 },
    })
    expect(JSON.stringify(snapshot)).not.toContain('must not be projected')
  })
})
