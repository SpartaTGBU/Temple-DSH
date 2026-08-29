import { describe, expect, it } from 'vitest'
import {
  contentBytesOf,
  EVENT_OBJECT_OVERHEAD_BYTES,
  estimateEvents,
  estimateSessionMemory,
  reportSessionMemory,
  utf8ByteLength,
} from '@deepseek-ai/dsh-memory-meter'

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte each', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('')).toBe(0)
  })

  it('counts multi-byte code points by UTF-8 width', () => {
    expect(utf8ByteLength('e\u0301')).toBe(3)
    expect(utf8ByteLength('\u00e9')).toBe(2)
    expect(utf8ByteLength('\u4e2d')).toBe(3)
    expect(utf8ByteLength('\ud83d\ude00')).toBe(4)
  })
})

describe('contentBytesOf', () => {
  it('measures serialized JSON byte length', () => {
    expect(contentBytesOf({ a: 1 })).toBe(utf8ByteLength('{"a":1}'))
    expect(contentBytesOf('hi')).toBe(utf8ByteLength('"hi"'))
  })

  it('returns zero for an unserializable cyclic value', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(contentBytesOf(cyclic)).toBe(0)
  })

  it('returns zero for undefined (JSON.stringify yields undefined)', () => {
    expect(contentBytesOf(undefined)).toBe(0)
  })
})

describe('estimateEvents', () => {
  it('sums content bytes and applies fixed per-event overhead', () => {
    const events = [{ a: 1 }, { b: 2 }]
    const content = contentBytesOf({ a: 1 }) + contentBytesOf({ b: 2 })
    const estimate = estimateEvents(events)
    expect(estimate.count).toBe(2)
    expect(estimate.contentBytes).toBe(content)
    expect(estimate.overheadBytes).toBe(2 * EVENT_OBJECT_OVERHEAD_BYTES)
    expect(estimate.retainedBytes).toBe(content + 2 * EVENT_OBJECT_OVERHEAD_BYTES)
  })

  it('is monotonic in log size', () => {
    const small = estimateEvents([{ a: 1 }])
    const large = estimateEvents([{ a: 1 }, { b: 2 }, { c: 3 }])
    expect(large.retainedBytes).toBeGreaterThan(small.retainedBytes)
  })

  it('handles an empty collection', () => {
    expect(estimateEvents([])).toEqual({ count: 0, contentBytes: 0, overheadBytes: 0, retainedBytes: 0 })
  })
})

describe('estimateSessionMemory', () => {
  it('measures an event-bearing unit through its public events surface', () => {
    const session = { events: [{ type: 'user/message' }, { type: 'assistant/message' }] }
    const estimate = estimateSessionMemory(session)
    expect(estimate.count).toBe(2)
    expect(estimate.retainedBytes).toBe(estimateEvents(session.events).retainedBytes)
  })
})

describe('reportSessionMemory', () => {
  it('ranks sessions by descending retained bytes and totals them', () => {
    const store = {
      list: () => [
        { id: 'small', events: [{ a: 1 }] },
        { id: 'large', events: [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }] },
        { id: 'mid', events: [{ a: 1 }, { b: 2 }] },
      ],
    }
    const report = reportSessionMemory(store)
    expect(report.sessionCount).toBe(3)
    expect(report.sessions.map(s => s.id)).toEqual(['large', 'mid', 'small'])
    expect(report.totalRetainedBytes).toBe(
      report.sessions.reduce((sum, s) => sum + s.estimate.retainedBytes, 0),
    )
  })

  it('stringifies non-string ids and handles an empty store', () => {
    expect(reportSessionMemory({ list: () => [] })).toEqual({
      sessions: [],
      totalRetainedBytes: 0,
      sessionCount: 0,
    })
    const report = reportSessionMemory({ list: () => [{ id: 42, events: [] }] })
    expect(report.sessions[0]!.id).toBe('42')
  })
})
