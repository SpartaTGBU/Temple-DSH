import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemPalaceMemory } from '@deepseek-ai/dsh-memory-mempalace'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('MemPalace Loader composition', () => {
  it('loads the subprocess and configured provider as the sole memory authority', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-mempalace-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: '@deepseek-ai/dsh-memory-mempalace'",
      '  config:',
      '    maxGraphNodes: 7',
      '    maxGraphEdges: 11',
      '    maxGraphHops: 3',
      '    maxGraphBytes: 4096',
      '    maxGraphScanRecords: 31',
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-memory-mempalace', MemPalaceMemory],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.memory).toBeInstanceOf(MemPalaceMemory)
    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    await expect(context.memory.exploreGraph({ maxNodes: 8, maxEdges: 1, maxHops: 0, maxBytes: 2048 }))
      .rejects.toThrow(/maxNodes/)
    expect(context.memory.status().workerStarts).toBe(0)
  })
})
