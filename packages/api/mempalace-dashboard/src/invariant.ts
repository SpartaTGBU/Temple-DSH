/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-api-mempalace-dashboard`.
 * @module @deepseek-ai/dsh-api-mempalace-dashboard/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-mempalace-dashboard'

/** Cordis companion plugin name. */
export const name = 'api-mempalace-dashboard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package is an opt-in read-only adapter with no
 * retained mutable state; normalization and unavailable states are covered by
 * projection tests against real SQLite fixtures.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
