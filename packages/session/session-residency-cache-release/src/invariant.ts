/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-residency-cache-release`.
 * @module @deepseek-ai/dsh-session-residency-cache-release/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-residency-cache-release'

/** Cordis companion plugin name. */
export const name = 'session-residency-cache-release-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this executor releases lazily-rebuilt caches and owns no durable event
 * stream or authoritative data relationship; observational identity after release is exercised by
 * the session package's derived-cache tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
