import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner, {
  lineCount,
  resolveConfig,
} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import type { ToolResultPruneConfig } from '@deepseek-ai/dsh-compaction-tool-result-pruner'

function service(config: ToolResultPruneConfig): ToolResultPruner {
  const ctx = new Context()
  void new TokenMeter(ctx)
  return new ToolResultPruner(ctx, config)
}

describe('ToolResultPruner dual-limit (maxLines) triggering', () => {
  it('resolves and validates the optional maxLines budget', () => {
    expect(resolveConfig({ maxLines: 10 }).maxLines).toBe(10)
    expect(resolveConfig({}).maxLines).toBeUndefined()
    expect(() => resolveConfig({ maxLines: 0 })).toThrow(/maxLines/)
    expect(() => resolveConfig({ maxLines: 1.5 })).toThrow(/maxLines/)
  })

  it('counts newline-delimited lines, ignoring a single trailing newline', () => {
    expect(lineCount('a\nb\nc')).toBe(3)
    expect(lineCount('a\nb\nc\n')).toBe(3)
    expect(lineCount('')).toBe(0)
    expect(lineCount('single')).toBe(1)
  })

  it('measureLines concatenates text blocks and ignores non-text', () => {
    const prune = service({ thresholdChars: 50, headChars: 4, tailChars: 3, maxLines: 3 })
    const blocks = [
      { type: 'text' as const, text: 'a\nb' },
      { type: 'reasoning' as const, text: 'x\ny\nz' },
      { type: 'text' as const, text: '\nc' },
    ]
    expect(prune.measureLines(blocks)).toBe(3)
  })

  it('does not trigger on line count when maxLines is unset', () => {
    const prune = service({ thresholdChars: 50, headChars: 4, tailChars: 3 })
    const shortManyLines = [{ type: 'text' as const, text: 'a\n'.repeat(10) }]
    expect(prune.measureContent(shortManyLines)).toBeLessThanOrEqual(prune.config.thresholdChars)
    expect(prune.pruneContent(shortManyLines)).toBeNull()
  })

  it('prunes a line-heavy result when maxLines trips before the char budget', () => {
    const prune = service({ thresholdChars: 2000, headChars: 200, tailChars: 200, maxLines: 10 })
    const line = 'x'.repeat(19)
    const blocks = [{ type: 'text' as const, text: Array.from({ length: 40 }, () => line).join('\n') }]
    expect(prune.measureContent(blocks)).toBeLessThanOrEqual(2000)
    expect(prune.measureLines(blocks)).toBe(40)
    const result = prune.pruneContent(blocks)
    expect(result).not.toBeNull()
    expect(prune.measureContent(result!)).toBeLessThan(prune.measureContent(blocks))
    const text = result!.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('pruned')
  })

  it('skips a line-triggered result too small to shrink past the marker', () => {
    const prune = service({ thresholdChars: 2000, headChars: 200, tailChars: 200, maxLines: 3 })
    const blocks = [{ type: 'text' as const, text: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8' }]
    expect(prune.exceedsBudget(blocks)).toBe(true)
    expect(prune.pruneContent(blocks)).toBeNull()
  })

  it('reports exceedsBudget for either dimension independently', () => {
    const prune = service({ thresholdChars: 50, headChars: 4, tailChars: 3, maxLines: 3 })
    expect(prune.exceedsBudget([{ type: 'text', text: 'a\nb' }])).toBe(false)
    expect(prune.exceedsBudget([{ type: 'text', text: 'a\nb\nc\nd' }])).toBe(true)
    expect(prune.exceedsBudget([{ type: 'text', text: 'x'.repeat(100) }])).toBe(true)
  })
})
