import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

interface Row {
  readonly id?: string
  readonly disabled?: { readonly __jsExpr?: string }
}

function rows(path: URL): Row[] {
  const parsed = yaml.load(readFileSync(fileURLToPath(path), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('bundle patch must be an array')
  return parsed.flatMap(value => (
    typeof value === 'object' && value !== null
      ? (value as { insert?: Row[] }).insert ?? []
      : []
  ))
}

describe('MemPalace Web composition', () => {
  it('uses one opt-in expression for provider, Host API, and browser UI', () => {
    const webRows = rows(new URL('../cordis.patch.yml', import.meta.url))
    const baseRows = rows(new URL('../../base/cordis.patch.yml', import.meta.url))
    const ids = ['memory-mempalace', 'memory-context', 'mempalace-dashboard', 'ui-mempalace-dashboard']
    const selected = ids.map(id => [...baseRows, ...webRows].find(row => row.id === id))
    const expressions = selected.map(row => row?.disabled?.__jsExpr)
    expect(expressions).toEqual(ids.map(() => "process.env.MEMPALACE_ENABLED !== '1'"))
    for (const enabled of [undefined, '0', '1']) {
      const disabled = expressions.map(expression => Boolean(evaluate({ process: { env: { MEMPALACE_ENABLED: enabled } } }, expression!)))
      expect(new Set(disabled).size).toBe(1)
      expect(disabled[0]).toBe(enabled !== '1')
    }
  })
})
