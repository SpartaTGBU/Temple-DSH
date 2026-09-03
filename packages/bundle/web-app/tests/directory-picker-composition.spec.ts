import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Row {
  readonly id?: string
  readonly name?: string
}

function insertedRows(): Row[] {
  const parsed = yaml.load(
    readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('web bundle patch must be an array')
  return parsed.flatMap(value => (
    typeof value === 'object' && value !== null
      ? (value as { insert?: Row[] }).insert ?? []
      : []
  ))
}

describe('Web directory-picker composition', () => {
  it('statically mounts the browser-reachable browse backend and surface', () => {
    const rows = insertedRows()
    expect(rows.find(row => row.id === 'directory-picker-browse')).toEqual({
      id: 'directory-picker-browse',
      name: '@deepseek-ai/dsh-host-directory-picker-browse',
    })
    expect(rows.find(row => row.id === 'ui-directory-picker-browse')).toEqual({
      id: 'ui-directory-picker-browse',
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    })
    expect(rows.some(row => row.name === '@deepseek-ai/dsh-host-directory-picker-auto')).toBe(false)
    expect(rows.some(row => row.name === '@deepseek-ai/dsh-client-ui-directory-picker-native')).toBe(false)
  })
})
