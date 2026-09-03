/** Package-owned invariant companion for `@deepseek-ai/dsh-memory-context`. @module @deepseek-ai/dsh-memory-context/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-memory-context'
/** Cordis companion plugin name. */
export const name = 'memory-context-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: source attribution and per-turn gates are enforced at insertion. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
