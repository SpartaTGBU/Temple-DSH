import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import {
  countChunkEvents,
  estimateChunkReclaim,
  reportChunkReclaim,
} from '@deepseek-ai/dsh-memory-meter/chunk-reclaim'

/** Append a streamed assistant message: many text-delta chunks then the sealed message. */
function streamAssistant(session: Session, turn: number, deltas: number): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/chunk', { turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
  for (let i = 0; i < deltas; i++) {
    session.append('assistant/chunk', { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: `tok${i} ` } })
  }
  session.append('assistant/chunk', { turn, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } } })
  session.append('assistant/message', {
    turn, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('countChunkEvents', () => {
  it('counts assistant/chunk events only', () => {
    const session = Session.create(SessionId('count'))
    streamAssistant(session, 1, 10)
    // 10 text-deltas + 1 block-start + 1 block-end = 12 chunk events
    expect(countChunkEvents(session.events)).toBe(12)
    expect(countChunkEvents([])).toBe(0)
  })
})

describe('estimateChunkReclaim', () => {
  it('reports positive reclaimable bytes for a chunk-heavy session', () => {
    const session = Session.create(SessionId('reclaim'))
    streamAssistant(session, 1, 200)
    const est = estimateChunkReclaim(session.events)
    expect(est.chunkEvents).toBeGreaterThan(200)
    expect(est.residentBytes).toBeGreaterThan(est.packedBytes)
    expect(est.reclaimableBytes).toBe(est.residentBytes - est.packedBytes)
    expect(est.reclaimableBytes).toBeGreaterThan(0)
  })

  it('reports zero reclaim for a session with no packable runs', () => {
    const session = Session.create(SessionId('no-chunks'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const est = estimateChunkReclaim(session.events)
    expect(est.chunkEvents).toBe(0)
    expect(est.reclaimableBytes).toBe(0)
  })

  it('does not mutate the session log', () => {
    const session = Session.create(SessionId('immutable'))
    streamAssistant(session, 1, 50)
    const before = session.events
    estimateChunkReclaim(session.events)
    expect(session.events).toBe(before)
    expect(session.events.length).toBe(before.length)
  })
})

describe('reportChunkReclaim', () => {
  it('ranks sessions by descending reclaimable chunk bytes', () => {
    const big = Session.create(SessionId('big'))
    streamAssistant(big, 1, 300)
    const small = Session.create(SessionId('small'))
    streamAssistant(small, 1, 20)
    const store = { list: () => [small, big] }
    const report = reportChunkReclaim(store)
    expect(report.map(e => e.id)).toEqual(['big', 'small'])
    expect(report[0]!.estimate.reclaimableBytes).toBeGreaterThan(report[1]!.estimate.reclaimableBytes)
  })
})
