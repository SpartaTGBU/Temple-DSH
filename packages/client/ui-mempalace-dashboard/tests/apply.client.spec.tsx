// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { MEMPALACE_DASHBOARD_ENDPOINT } from '@deepseek-ai/dsh-api-mempalace-dashboard/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { MemPalaceDashboardSection } from '../src/client/MemPalaceDashboardSection.tsx'
import type { MemPalaceDashboardSectionInjected } from '../src/client/MemPalaceDashboardSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SNAPSHOT = {
  generatedAt: '2026-01-01T00:00:00Z',
  location: { palacePath: '/tmp/palace', configPath: '/tmp/config.json', collectionName: 'mempalace_drawers', backend: 'sqlite_exact' },
  filters: { limit: 25 },
  structure: { available: false, reason: 'palace-not-found', message: 'missing' },
  knowledgeGraph: { available: false, reason: 'knowledge-graph-not-found', message: 'missing' },
  health: { available: false, reason: 'palace-not-found', message: 'missing' },
  retrievalTransparency: { available: false, reason: 'retrieval-traces-not-persisted', message: 'not persisted' },
} as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class ConnectionService extends Service {
    readonly rpc = {
      call: vi.fn().mockResolvedValue({ ok: true, value: SNAPSHOT }),
    }
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'connection')
    }
  }
  const connection = new ConnectionService(ctx)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, connection }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-mempalace-dashboard browser plugin', () => {
  it('declares the services used by the Settings section', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers a localized section and calls the opt-in Host endpoint lazily', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(MemPalaceDashboardSection)
    expect(entry.options).toMatchObject({ id: 'mempalace-dashboard', order: 85 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('MemPalace')
    expect(b.connection.rpc.call).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => MemPalaceDashboardSectionInjected)()
    await expect(injected.inspect({ wing: 'wing_alpha' })).resolves.toEqual(SNAPSHOT)
    expect(b.connection.rpc.call).toHaveBeenCalledWith(
      '/api',
      MEMPALACE_DASHBOARD_ENDPOINT,
      { wing: 'wing_alpha' },
    )
    b.connection.rpc.call.mockResolvedValueOnce({ ok: false, error: { code: 'missing', message: 'no API', details: {} } })
    await expect(injected.inspect({})).rejects.toThrow('mempalaceDashboard.inspect failed: missing: no API')
    await b.ctx.fiber.dispose()
  })

  it('follows late slot declaration and teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })
})
