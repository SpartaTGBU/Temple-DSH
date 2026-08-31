import { describe, expect, it } from 'vitest'
import {
  coldBoundaryOf,
  estimateLogTiering,
  reportLogTiering,
} from '@deepseek-ai/dsh-memory-meter/log-tiering'

/** A minimal tierable session: N events and a surface whose lowest node is `min`. */
function fake(id: string, eventCount: number, surfaceNodes: number[]): { id: string; events: unknown[]; surface: { nodes: number[] } } {
  const events = Array.from({ length: eventCount }, (_, i) => ({ type: 'x', seq: i, data: `event ${i}` }))
  return { id, events, surface: { nodes: surfaceNodes } }
}

describe('coldBoundaryOf', () => {
  it('is the lowest surface node', () => {
    expect(coldBoundaryOf(fake('a', 10, [3, 5, 8]))).toBe(3)
    expect(coldBoundaryOf(fake('a', 10, [8, 5, 3]))).toBe(3)
  })
  it('is the full length when there are no surface nodes', () => {
    expect(coldBoundaryOf(fake('a', 10, []))).toBe(10)
  })
})

describe('estimateLogTiering', () => {
  it('splits cold prefix from hot tail by the lowest surface node', () => {
    const session = fake('split', 10, [4, 6, 9])
    const est = estimateLogTiering(session)
    expect(est.totalEvents).toBe(10)
    expect(est.coldEvents).toBe(4)
    expect(est.hotEvents).toBe(6)
    expect(est.coldBoundary).toBe(4)
    expect(est.coldBytes).toBeGreaterThan(0)
    expect(est.hotBytes).toBeGreaterThan(0)
  })

  it('treats a session with no surface as entirely cold', () => {
    const est = estimateLogTiering(fake('all-cold', 5, []))
    expect(est.coldEvents).toBe(5)
    expect(est.hotEvents).toBe(0)
    expect(est.hotBytes).toBe(0)
    expect(est.coldBytes).toBeGreaterThan(0)
  })

  it('treats a session whose surface starts at 0 as entirely hot', () => {
    const est = estimateLogTiering(fake('all-hot', 5, [0, 2, 4]))
    expect(est.coldEvents).toBe(0)
    expect(est.hotEvents).toBe(5)
    expect(est.coldBytes).toBe(0)
  })

  it('is non-mutating', () => {
    const session = fake('immutable', 6, [2])
    const beforeEvents = session.events
    const beforeNodes = session.surface.nodes
    estimateLogTiering(session)
    expect(session.events).toBe(beforeEvents)
    expect(session.surface.nodes).toBe(beforeNodes)
  })
})

describe('reportLogTiering', () => {
  it('ranks sessions by descending cold bytes', () => {
    const store = {
      list: () => [
        fake('small-cold', 10, [2]),
        fake('big-cold', 12, [8]),
      ],
    }
    const report = reportLogTiering(store)
    expect(report.map(e => e.id)).toEqual(['big-cold', 'small-cold'])
    expect(report[0]!.estimate.coldBytes).toBeGreaterThan(report[1]!.estimate.coldBytes)
  })
})
