import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRuntime } from '@deepseek-ai/dsh-memory'
import type {
  MemoryCaptureTurn,
  MemoryGraphRequest,
  MemoryGraphResult,
  MemoryInspectionSource,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryStatus,
} from '@deepseek-ai/dsh-memory'

vi.mock('../src/worker-client.ts', () => ({
  ProjectionWorkers: class {
    async run(request: unknown, options: unknown) {
      const { buildMemPalaceDashboard } = await import('../src/projection.ts')
      return buildMemPalaceDashboard(request as never, options as never)
    }
    async dispose() {}
  },
}))

import * as dashboard from '../src/index.ts'
const { MEMPALACE_DASHBOARD_ENDPOINT } = dashboard

class TestMemory extends MemoryRuntime {
  constructor(ctx: Context, private readonly degraded = false) {
    super(ctx)
  }

  status(): MemoryStatus {
    return {
      state: this.degraded ? 'degraded' : 'ready',
      backend: 'mempalace',
      detail: 'secret-like provider detail must not cross the API',
      pendingCaptures: 2,
      workerStarts: 3,
    }
  }

  override async inspectionSource(): Promise<MemoryInspectionSource> {
    if (this.degraded) throw new Error('private executable and path details')
    return {
      kind: 'mempalace',
      palacePath: 'Z:/missing-provider-palace',
      collectionName: 'provider_collection',
      storageBackend: 'sqlite_exact',
      wing: 'wing_provider',
    }
  }

  recall(_request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    return Promise.resolve({ backend: 'mempalace', items: [], truncated: false })
  }

  exploreGraph(_request: MemoryGraphRequest): Promise<MemoryGraphResult> {
    return Promise.reject(new Error('unused in dashboard composition test'))
  }

  captureTurn(_turn: MemoryCaptureTurn): Promise<void> {
    return Promise.resolve()
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }
}

interface CapturedEndpoint {
  handler: ((_endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
}

async function composed(memory: 'ready' | 'degraded' | 'missing', disabled = false) {
  const ctx = new Context()
  const captured: CapturedEndpoint = { handler: undefined }
  const stop = vi.fn()
  ctx.provide('connection', {
    rpc: {
      intercept: (_route: string, accepts: (endpoint: string) => boolean, handler: CapturedEndpoint['handler']) => {
        expect(accepts(MEMPALACE_DASHBOARD_ENDPOINT)).toBe(true)
        captured.handler = handler
        return stop
      },
    },
  } as never)
  if (memory !== 'missing') new TestMemory(ctx, memory === 'degraded')
  await ctx.plugin(Loader)
  ctx.loader.builtins.dashboard = dashboard
  await ctx.loader.create({
    name: 'cordis:dashboard',
    disabled,
  })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:dashboard')
  if (entry === undefined) throw new Error('Loader did not retain the dashboard row')
  return { ctx, captured, entry, stop }
}

describe('MemPalace dashboard Loader composition', () => {
  it('mounts the default endpoint, reads provider-owned coordinates, and disposes the interceptor', async () => {
    const fixture = await composed('ready')
    const result = await fixture.captured.handler?.(
      MEMPALACE_DASHBOARD_ENDPOINT,
      { limit: 7 },
      new AbortController().signal,
    ) as {
      ok: true
      value: Record<string, unknown>
    }
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({
      provider: {
        available: true,
        value: { state: 'ready', backend: 'mempalace', pendingCaptures: 2, workerStarts: 3 },
      },
      location: {
        available: true,
        value: {
          collectionName: 'provider_collection',
          backend: 'sqlite_exact',
          wing: 'wing_provider',
          authority: 'memory-provider',
        },
      },
      filters: { limit: 7 },
    })
    expect(JSON.stringify(result.value)).toContain('missing-provider-palace')
    expect(JSON.stringify(result)).not.toContain('secret-like')
    await fixture.ctx.fiber.dispose()
    expect(fixture.stop).toHaveBeenCalledOnce()
  })

  it('keeps a disabled Loader row inert', async () => {
    const fixture = await composed('ready', true)
    expect(fixture.entry.disabled).toBe(true)
    expect(fixture.entry.fiber).toBeUndefined()
    expect(fixture.captured.handler).toBeUndefined()
    await fixture.ctx.fiber.dispose()
  })

  it.each([
    ['missing', 'memory-provider-not-found'],
    ['degraded', 'memory-provider-unavailable'],
  ] as const)('returns an explicit unavailable snapshot for a %s provider', async (mode, reason) => {
    const fixture = await composed(mode)
    const result = await fixture.captured.handler?.(
      MEMPALACE_DASHBOARD_ENDPOINT,
      {},
      new AbortController().signal,
    ) as {
      ok: true
      value: { provider: { reason: string }; structure: { reason: string } }
    }
    expect(result.value.provider.reason).toBe(reason)
    expect(result.value.structure.reason).toBe(reason)
    expect(JSON.stringify(result)).not.toContain('private executable')
    await fixture.ctx.fiber.dispose()
  })
})
