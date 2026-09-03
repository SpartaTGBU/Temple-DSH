// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemPalaceDashboardSnapshot } from '@deepseek-ai/dsh-api-mempalace-dashboard/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { MemPalaceDashboardSection } from '../src/client/MemPalaceDashboardSection.tsx'
import type { MemPalaceDashboardSectionInjected, MemPalaceDashboardSectionProps } from '../src/client/MemPalaceDashboardSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

type AvailableProviderSnapshot = Omit<MemPalaceDashboardSnapshot, 'provider'> & {
  readonly provider: Extract<MemPalaceDashboardSnapshot['provider'], { readonly available: true }>
}

const SNAPSHOT: AvailableProviderSnapshot = {
  generatedAt: '2026-01-01T00:00:00Z',
  provider: { available: true, value: { state: 'ready', backend: 'mempalace', pendingCaptures: 0, workerStarts: 1 } },
  location: {
    available: true,
    value: {
      palacePath: '/tmp/palace',
      collectionName: 'mempalace_drawers',
      backend: 'sqlite_exact',
      wing: 'wing_general',
      authority: 'memory-provider',
    },
  },
  filters: { limit: 25 },
  structure: { available: false, reason: 'palace-not-found', message: 'missing' },
  knowledgeGraph: { available: false, reason: 'knowledge-graph-not-found', message: 'missing' },
  health: { available: false, reason: 'palace-not-found', message: 'missing' },
  retrievalTransparency: { available: false, reason: 'retrieval-traces-not-persisted', message: 'not persisted' },
}

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
      'mempalaceDashboard/inspect',
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

  it('renders provider and unavailable facts and only refreshes after filter submission', async () => {
    const inspect = vi.fn().mockResolvedValue(SNAPSHOT)
    const t = (key: string, values?: Record<string, unknown>): string => {
      if (key === 'providerStatus') return `${String(values?.state)} ${String(values?.starts)}`
      return key
    }
    render(<MemPalaceDashboardSection
      {...({} as MemPalaceDashboardSectionProps)}
      inspect={inspect}
      close={vi.fn()}
      t={t as never}
    />)
    await screen.findByText('ready 1')
    expect(screen.getByText('/tmp/palace')).toBeDefined()
    expect(screen.getAllByText('missing').length).toBeGreaterThan(0)
    expect(inspect).toHaveBeenCalledOnce()

    fireEvent.change(screen.getByLabelText('wingFilter'), { target: { value: 'wing_alpha' } })
    expect(inspect).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => { expect(inspect).toHaveBeenCalledTimes(2) })
    expect(inspect).toHaveBeenLastCalledWith({ wing: 'wing_alpha', room: '', query: '', limit: 25 })
  })

  it('does not let an older response replace a newer submitted snapshot', async () => {
    const resolves: Array<(value: typeof SNAPSHOT) => void> = []
    const inspect = vi.fn(() => new Promise<typeof SNAPSHOT>((resolve) => { resolves.push(resolve) }))
    const t = (key: string, values?: Record<string, unknown>): string => key === 'providerStatus'
      ? `${String(values?.state)} ${String(values?.pending)}`
      : key
    render(<MemPalaceDashboardSection
      {...({} as MemPalaceDashboardSectionProps)}
      inspect={inspect}
      close={vi.fn()}
      t={t as never}
    />)
    await waitFor(() => { expect(resolves).toHaveLength(1) })
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => { expect(resolves).toHaveLength(2) })
    resolves[1]?.({
      ...SNAPSHOT,
      provider: { available: true, value: { ...SNAPSHOT.provider.value, pendingCaptures: 2 } },
    })
    await screen.findByText('ready 2')
    resolves[0]?.(SNAPSHOT)
    await waitFor(() => { expect(screen.getByText('ready 2')).toBeDefined() })
    expect(screen.queryByText('ready 0')).toBeNull()
  })
})
