/** Package-owned invariant companion for `@deepseek-ai/dsh-memory-mempalace`. @module @deepseek-ai/dsh-memory-mempalace/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-memory-mempalace'
/** Cordis companion plugin name. */
export const name = 'memory-mempalace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: the JSONL protocol validates every response at the provider boundary. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
