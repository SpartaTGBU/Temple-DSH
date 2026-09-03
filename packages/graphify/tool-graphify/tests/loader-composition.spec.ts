import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface GraphifyLoaderReport {
  toolNames: string[]
  indexText: string
  queryText: string
  indexValue?: { argv: string[]; targetPath: string }
  queryValue?: { argv: string[]; graphPath: string }
}

describe('tool-graphify through a real Loader composition', () => {
  it('registers the opt-in tools and calls an argv-only fake CLI', async () => {
    let report: GraphifyLoaderReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'tool-graphify loader smoke',
      tempDirPrefix: 'tool-graphify-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      processTimeoutMs: 30_000,
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'graphify-loader-report.json'), 'utf8')) as GraphifyLoaderReport
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(report).toBeDefined()
    expect(report?.toolNames).toEqual(['graphify_index', 'graphify_query'])
    expect(report?.indexText).toContain('graphify fake update')
    expect(report?.queryText).toContain('graphify fake explain ToolRuntime --graph')
    expect(report?.indexValue?.argv[0]).toBe('update')
    expect(report?.queryValue?.argv.slice(0, 2)).toEqual(['explain', 'ToolRuntime'])
  }, 45_000)
})
