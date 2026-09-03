#!/usr/bin/env node
/** Boot the tool-graphify Loader fixture with a fake CLI and record tool output. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

const configTemplate = process.argv[2]
if (configTemplate === undefined) throw new Error('tool-graphify driver requires a config path')

const workspace = resolve('workspace')
await mkdir(join(workspace, 'src'), { recursive: true })
await mkdir(join(workspace, 'graphify-out'), { recursive: true })
await writeFile(join(workspace, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}\n')
const fakeBin = resolve('graphify-fake.mjs')
await writeFile(fakeBin, 'console.log(`graphify fake ${process.argv.slice(2).join(" ")}`)\n', 'utf8')

const rendered = (await readFile(configTemplate, 'utf8'))
  .replaceAll('__WORKSPACE__', JSON.stringify(workspace))
  .replaceAll('__GRAPHIFY_BIN__', JSON.stringify(process.execPath))
  .replaceAll('__GRAPHIFY_SCRIPT__', JSON.stringify(fakeBin))
const configPath = resolve('cordis.graphify.yml')
await writeFile(configPath, rendered)

const ctx = await boot('tool-graphify-loader-smoke', resolveConfigPath(configPath, undefined))
try {
  const schemas = ctx.tools.schemas()
  const indexSchema = schemas.find(tool => tool.name === 'graphify_index')
  const querySchema = schemas.find(tool => tool.name === 'graphify_query')
  if (indexSchema === undefined || querySchema === undefined) throw new Error('graphify tools not registered')

  const index = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('graphify-loader-index'),
    name: 'graphify_index',
    arguments: { operation: 'update' },
  })
  const query = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('graphify-loader-query'),
    name: 'graphify_query',
    arguments: { operation: 'explain', node: 'ToolRuntime' },
  })
  const text = (result: typeof index): string => result.content.filter(block => block.type === 'text').map(block => block.text).join('')

  await writeFile('graphify-loader-report.json', JSON.stringify({
    toolNames: schemas.map(tool => tool.name).filter(name => name.startsWith('graphify_')).sort(),
    indexText: text(index),
    queryText: text(query),
    indexValue: index.isError ? undefined : index.value,
    queryValue: query.isError ? undefined : query.value,
  }))
} finally {
  await ctx.fiber.dispose()
}
