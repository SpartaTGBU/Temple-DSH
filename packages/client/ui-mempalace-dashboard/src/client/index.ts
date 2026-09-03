/** Browser MemPalace dashboard Settings section. */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { MemPalaceDashboardRequest, MemPalaceDashboardSnapshot } from '@deepseek-ai/dsh-api-mempalace-dashboard/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MemPalaceDashboardSection, type MemPalaceDashboardSectionInjected } from './MemPalaceDashboardSection.tsx'
import { en, zh, type MemPalaceDashboardKey } from './locales.ts'

export type { MemPalaceDashboardSectionInjected, MemPalaceDashboardSectionProps } from './MemPalaceDashboardSection.tsx'
export type { MemPalaceDashboardKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'mempalaceDashboard'
const ENDPOINT = 'mempalaceDashboard/inspect'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MemPalace dashboard Settings section copy. */
    mempalaceDashboard: MemPalaceDashboardKey
  }
}

/** Services required by the browser dashboard plugin. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register a read-only Settings section that calls the opt-in Host API.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mempalace-dashboard: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as { readonly rpc: ClientConnectionRpc }
  const injected = (): MemPalaceDashboardSectionInjected => ({
    inspect: async (request: MemPalaceDashboardRequest) => {
      const result = await connection.rpc.call('/api', ENDPOINT, request)
      if (!result.ok) throw new Error(`mempalaceDashboard.inspect failed: ${result.error.code}: ${result.error.message}`)
      return result.value as MemPalaceDashboardSnapshot
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mempalace-dashboard',
    order: 85,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemPalaceDashboardSection))
}
