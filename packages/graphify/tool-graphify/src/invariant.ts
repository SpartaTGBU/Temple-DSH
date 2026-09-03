/** Package-owned Graphify tool-result invariants. @module @deepseek-ai/dsh-tool-graphify/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-graphify'

/** Cordis companion plugin name. */
export const name = 'tool-graphify-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateStream(value: unknown, field: string, fail: InvariantFailure): void {
  if (!isRecord(value)) fail(`${field} must be an object`)
  const record = value
  if (typeof record.text !== 'string') fail(`${field}.text must be a string`)
  if (typeof record.truncated !== 'boolean') fail(`${field}.truncated must be a boolean`)
  if ('spillPath' in record) fail(`${field}.spillPath must not be exposed`)
}

function validateGraphifyValue(value: unknown, toolName: string, fail: InvariantFailure): void {
  if (!isRecord(value)) fail(`${toolName} result value must be an object`)
  const record = value
  if (toolName === 'graphify_index' && record.kind !== 'index') fail('graphify_index result kind must be index')
  if (toolName === 'graphify_query' && record.kind !== 'query') fail('graphify_query result kind must be query')
  if (typeof record.operation !== 'string' || record.operation.length === 0) fail(`${toolName} operation must be non-empty`)
  if (typeof record.workspaceRoot !== 'string' || record.workspaceRoot.length === 0) fail(`${toolName} workspaceRoot must be non-empty`)
  if (!Array.isArray(record.argv) || record.argv.some((item: unknown) => typeof item !== 'string' || item.length === 0)) {
    fail(`${toolName} argv must be non-empty strings`)
  }
  if (typeof record.timedOut !== 'boolean') fail(`${toolName} timedOut must be a boolean`)
  if (typeof record.aborted !== 'boolean') fail(`${toolName} aborted must be a boolean`)
  if (!(typeof record.exitCode === 'number' || record.exitCode === null)) fail(`${toolName} exitCode must be a number or null`)
  if (!(typeof record.signal === 'string' || record.signal === null)) fail(`${toolName} signal must be a string or null`)
  validateStream(record.stdout, `${toolName}.stdout`, fail)
  validateStream(record.stderr, `${toolName}.stderr`, fail)
  if (record.exitCode === 0 && record.signal === null && !record.timedOut && !record.aborted) {
    if ((record.stdout as { text: string }).text.length === 0 && record.operation === 'query') {
      fail('successful graphify_query result must carry stdout text')
    }
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode: string, eventName: string, args: unknown[]) => {
    if (eventName !== 'tools/result') return
    const [exec, result] = args as [{ name: string }, ToolExecutionResult]
    if (exec.name !== 'graphify_index' && exec.name !== 'graphify_query') return
    if (result.isError) return
    validateGraphifyValue(result.value, exec.name, fail)
  }, { global: true })
}, { inject: ['tools'] })

/**
 * Register the Graphify invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
