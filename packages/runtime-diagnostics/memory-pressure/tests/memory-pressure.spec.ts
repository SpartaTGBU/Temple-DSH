import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryPressure, {
  classifyPressure,
  DEFAULT_CRITICAL_BYTES,
  DEFAULT_ELEVATED_BYTES,
} from '@deepseek-ai/dsh-memory-pressure'
import type { MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'

describe('classifyPressure', () => {
  it('classifies against the watermarks (inclusive lower bounds)', () => {
    expect(classifyPressure(0, 100, 200)).toBe('normal')
    expect(classifyPressure(99, 100, 200)).toBe('normal')
    expect(classifyPressure(100, 100, 200)).toBe('elevated')
    expect(classifyPressure(199, 100, 200)).toBe('elevated')
    expect(classifyPressure(200, 100, 200)).toBe('critical')
    expect(classifyPressure(1_000, 100, 200)).toBe('critical')
  })
})

describe('MemoryPressure config validation', () => {
  it('exposes sane defaults', () => {
    expect(DEFAULT_ELEVATED_BYTES).toBe(1024 * 1024 * 1024)
    expect(DEFAULT_CRITICAL_BYTES).toBeGreaterThan(DEFAULT_ELEVATED_BYTES)
  })

  it('rejects a critical watermark not above the elevated one', () => {
    const ctx = new Context()
    expect(() => new MemoryPressure(ctx, { elevatedBytes: 200, criticalBytes: 200 })).toThrow(/must exceed/)
    expect(() => new MemoryPressure(ctx, { elevatedBytes: 300, criticalBytes: 200 })).toThrow(/must exceed/)
  })
})

describe('MemoryPressure sampling and transitions', () => {
  function make(readings: number[]): { service: MemoryPressure; events: MemoryPressureSample[] } {
    const ctx = new Context()
    const events: MemoryPressureSample[] = []
    ctx.on('runtime/memory-pressure', (sample) => { events.push(sample) })
    let i = 0
    const reader = () => readings[Math.min(i++, readings.length - 1)] ?? 0
    const service = new MemoryPressure(ctx, { elevatedBytes: 100, criticalBytes: 200, intervalMs: 1_000_000 }, reader)
    return { service, events }
  }

  it('starts normal and emits nothing without a transition', () => {
    const { service, events } = make([10, 20, 30])
    expect(service.level).toBe('normal')
    service.sample()
    service.sample()
    expect(events).toHaveLength(0)
    expect(service.level).toBe('normal')
  })

  it('emits once per transition, carrying the triggering reading', () => {
    const { service, events } = make([150, 250, 250, 50])
    service.sample() // normal -> elevated
    expect(service.level).toBe('elevated')
    service.sample() // elevated -> critical
    expect(service.level).toBe('critical')
    service.sample() // critical -> critical (no emit)
    service.sample() // critical -> normal
    expect(service.level).toBe('normal')
    expect(events.map(e => e.level)).toEqual(['elevated', 'critical', 'normal'])
    expect(events[0]!.heapUsedBytes).toBe(150)
    expect(events[0]!.elevatedBytes).toBe(100)
    expect(events[0]!.criticalBytes).toBe(200)
  })

  it('samples on the interval timer', () => {
    vi.useFakeTimers()
    try {
      const ctx = new Context()
      const events: MemoryPressureSample[] = []
      ctx.on('runtime/memory-pressure', (sample) => { events.push(sample) })
      let reading = 10
      const service = new MemoryPressure(ctx, { elevatedBytes: 100, criticalBytes: 200, intervalMs: 50 }, () => reading)
      expect(events).toHaveLength(0)
      reading = 150
      vi.advanceTimersByTime(50)
      expect(service.level).toBe('elevated')
      expect(events).toHaveLength(1)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
