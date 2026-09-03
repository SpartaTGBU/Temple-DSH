import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply, normalizeMemPalaceBuildGraph } from '../src/index.ts'

const sampleGraph = {
  nodes: {
    auth: { wings: ['project_a', 'project_b'], halls: ['design'], count: 3, dates: ['2026-09-01'] },
    api: { wings: ['project_b'], halls: ['impl'], count: 2, dates: ['2026-09-02'] },
    billing: { wings: ['project_c'], halls: ['finance'], count: 1, dates: [] },
  },
  edges: [
    { room: 'auth', wing_a: 'project_b', wing_b: 'project_a', hall: 'design', count: 3 },
  ],
}

describe('normalizeMemPalaceBuildGraph', () => {
  it('normalizes build_graph nodes and tunnel edges into stable sorted data', () => {
    const graph = normalizeMemPalaceBuildGraph(sampleGraph, { source: 'direct', maxHops: 2, maxRooms: 10 })

    expect(graph.format).toBe('dsh.mempalace.multipass.graph.v1')
    expect(graph.rooms.map(room => room.room)).toEqual(['api', 'auth', 'billing'])
    expect(graph.tunnels).toEqual([
      { id: 'tunnel:auth:project_a:project_b:design', room: 'auth', wingA: 'project_a', wingB: 'project_b', hall: 'design', count: 3 },
    ])
    expect(graph.wings.map(wing => ({ name: wing.name, isolated: wing.isolated }))).toEqual([
      { name: 'project_a', isolated: false },
      { name: 'project_b', isolated: false },
      { name: 'project_c', isolated: true },
    ])
    expect(graph.visualization.nodes.some(node => node.id === 'wing:project_a' && node.kind === 'wing')).toBe(true)
    expect(graph.visualization.links.some(link => link.kind === 'passive_tunnel' && link.room === 'auth')).toBe(true)
  })

  it('reports isolated rooms and wings without inventing tunnels', () => {
    const graph = normalizeMemPalaceBuildGraph({
      nodes: {
        diary: { wings: ['agent_one'], halls: ['notes'], count: 1, dates: [] },
        archive: { wings: ['agent_two'], halls: ['notes'], count: 1, dates: [] },
      },
      edges: [],
    }, { source: 'direct', maxHops: 2, maxRooms: 10 })

    expect(graph.tunnels).toEqual([])
    expect(graph.rooms.every(room => room.isolated)).toBe(true)
    expect(graph.wings.every(wing => wing.isolated)).toBe(true)
    expect(graph.stats.isolatedRoomCount).toBe(2)
    expect(graph.stats.isolatedWingCount).toBe(2)
  })

  it('returns bounded multi-hop path data over shared wings', () => {
    const graph = normalizeMemPalaceBuildGraph(sampleGraph, { source: 'direct', startRoom: 'auth', maxHops: 1, maxRooms: 10 })

    expect(graph.paths).toEqual([
      { room: 'auth', hop: 0, path: ['auth'], connectedVia: [] },
      { room: 'api', hop: 1, path: ['auth', 'api'], connectedVia: ['project_b'] },
    ])
    expect(graph.stats.maxHop).toBe(1)
    expect(graph.visualization.links.some(link => link.kind === 'path' && link.source === 'room:auth' && link.target === 'room:api')).toBe(true)
  })

  it('accepts the JSON form of Python build_graph tuple output', () => {
    const graph = normalizeMemPalaceBuildGraph([sampleGraph.nodes, sampleGraph.edges], { source: 'direct', maxHops: 0, maxRooms: 10 })

    expect(graph.stats.roomCount).toBe(3)
    expect(graph.stats.tunnelCount).toBe(1)
  })

  it('rejects invalid graph input before returning an export', () => {
    expect(() => normalizeMemPalaceBuildGraph({ nodes: { auth: { wings: [], count: 1 } }, edges: [] }, { source: 'direct', maxHops: 1, maxRooms: 10 }))
      .toThrow(/wings must contain at least one wing/)
    expect(() => normalizeMemPalaceBuildGraph({ nodes: { auth: { wings: ['a'], count: 1 } }, edges: [{ room: 'missing', wing_a: 'a', wing_b: 'b' }] }, { source: 'direct', maxHops: 1, maxRooms: 10 }))
      .toThrow(/unknown room/)
    expect(() => normalizeMemPalaceBuildGraph({ nodes: { auth: { wings: ['a'], count: -1 } }, edges: [] }, { source: 'direct', maxHops: 1, maxRooms: 10 }))
      .toThrow(/non-negative safe integer/)
  })
})

describe('mempalace_multipass_explore tool', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('loads graph JSON from a local file and stamps file source', async () => {
    const ctx = await createToolContext()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mempalace-multipass-'))
    tempDirs.push(dir)
    const graphPath = join(dir, 'graph.json')
    await writeFile(graphPath, JSON.stringify(sampleGraph), 'utf8')
    const tool = ctx.tools.get('mempalace_multipass_explore')
    expect(tool).toBeDefined()

    const result = await tool?.execute({ graph_json_path: graphPath, start_room: 'auth', max_hops: 1 }, fakeExecution())

    expect((result as { source: string }).source).toBe('file')
    expect((result as { paths: unknown[] }).paths).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('unregisters the tool when its plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin({ name: 'test-mempalace-multipass', inject: ['tools'], apply })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mempalace_multipass_explore')

    await fiber.dispose()

    expect(ctx.tools.get('mempalace_multipass_explore')).toBeUndefined()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('mempalace_multipass_explore')
    await ctx.fiber.dispose()
  })
})

async function createToolContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin({ name: 'test-mempalace-multipass', inject: ['tools'], apply })
  return ctx
}

function fakeExecution(): ToolRunContext {
  const controller = new AbortController()
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name: 'mempalace_multipass_explore',
    arguments: {},
    signal: controller.signal,
    token: {},
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext
}
