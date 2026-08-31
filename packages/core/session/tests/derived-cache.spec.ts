import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
/**
 * Derived-message cache contract against a scratch oracle: project new nodes
 * once, rebuild on surface replacements, return fresh arrays over shared
 * frozen messages, and remain value-equal to replay at every step.
 */

import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

function userText(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** From-scratch oracle: replay the log into a fresh session and derive. */
function scratch(session: Session): unknown {
  return Session.create(SessionId(`${session.id}-scratch-${session.seq}`), [...session.events]).deriveMessages()
}

describe('derived-message cache', () => {
  it('stays deep-equal to a from-scratch replay derivation as the log grows', () => {
    const session = Session.create(SessionId('cache-grow'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    expect(session.deriveMessages()).toEqual(scratch(session))
    userText(session, 'two')
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    expect(session.deriveMessages()).toEqual(scratch(session))
    session.append('assistant/message', {
      turn: 1, step: 2,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
      usage: { inputTokens: 1, outputTokens: 0 },
    }, { surfaceOp: 'append' })
    expect(session.deriveMessages()).toEqual(scratch(session))
  })

  it('rebuilds on a surface replace and still matches scratch', () => {
    const session = Session.create(SessionId('cache-replace'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    userText(session, 'two')
    const beforeReplace = session.deriveMessages()
    expect(beforeReplace).toHaveLength(2)

    const nodes = session.surface.nodes
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: nodes[0]!, end: nodes[1]! }, sourceEventSeqs: [nodes[0]!, nodes[1]!] })

    expect(session.deriveMessages()).toHaveLength(1)
    expect(session.deriveMessages()).toEqual(scratch(session))
    expect(beforeReplace).toHaveLength(2)
  })

  it('returns a fresh array per call: later appends never grow a held snapshot', () => {
    const session = Session.create(SessionId('cache-snapshot'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    const first = session.deriveMessages()
    userText(session, 'two')
    const second = session.deriveMessages()
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    // Array snapshots share their frozen message projections.
    expect(second[0]).toBe(first[0])
    expect(Object.isFrozen(first[0])).toBe(true)
  })

})

describe('Session.deriveEventMessage — the per-event projection', () => {
  it('projects one appended event exactly as the full derivation projects its node', () => {
    const session = Session.create(SessionId('per-event'))
    session.append('turn/start', { turn: 1 })
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    // Full and per-event derivation share one projection.
    expect(session.deriveEventMessage(event)).toEqual(session.deriveMessages().at(-1))
  })

  it('reuses the logged event\'s already frozen content', () => {
    const session = Session.create(SessionId('per-event-clone'))
    session.append('turn/start', { turn: 1 })
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'orig' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const message = session.deriveEventMessage(event)!
    expect(message.content).toBe(event.data.content)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(() => { (message.content[0] as { text: string }).text = 'mutated' }).toThrow()
    expect(session.deriveMessages().at(-1)!.content).toEqual([{ type: 'text', text: 'orig' }])
  })

  it('projects null for events that produce no message (boundaries, empty assistant)', () => {
    const session = Session.create(SessionId('per-event-null'))
    session.append('turn/start', { turn: 1 })
    const boundary = session.append('step/start', { turn: 1, step: 1 })
    expect(session.deriveEventMessage(boundary)).toBeNull()
    const empty = session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    expect(session.deriveEventMessage(empty)).toBeNull()
  })
})

describe('deriveMessagesShared', () => {
  it('returns the same content as deriveMessages', () => {
    const session = Session.create(SessionId('shared-content'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    userText(session, 'two')
    expect([...session.deriveMessagesShared()]).toEqual(session.deriveMessages())
    expect(session.deriveMessagesShared()).toEqual(scratch(session))
  })

  it('returns a stable reference while the surface is unchanged, avoiding the copy', () => {
    const session = Session.create(SessionId('shared-stable'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    const first = session.deriveMessagesShared()
    const second = session.deriveMessagesShared()
    expect(second).toBe(first)
    // deriveMessages still returns a fresh copy each call.
    expect(session.deriveMessages()).not.toBe(first)
    expect(session.deriveMessages()).not.toBe(session.deriveMessages())
  })

  it('extends the shared array as the log grows and rebuilds on a surface replace', () => {
    const session = Session.create(SessionId('shared-grow'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    const before = session.deriveMessagesShared().length
    userText(session, 'two')
    expect(session.deriveMessagesShared().length).toBe(before + 1)
    expect([...session.deriveMessagesShared()]).toEqual(scratch(session))
  })
})

describe('releaseCaches', () => {
  it('is observationally identical: derived messages and events survive a release', () => {
    const session = Session.create(SessionId('release-identity'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    userText(session, 'two')
    const beforeMessages = session.deriveMessages()
    const beforeEvents = session.events

    const dropped = session.releaseCaches()
    expect(dropped).toBeGreaterThan(0)

    expect(session.deriveMessages()).toEqual(beforeMessages)
    expect(session.deriveMessages()).toEqual(scratch(session))
    expect(session.events).toEqual(beforeEvents)
  })

  it('keeps appending correct after a release', () => {
    const session = Session.create(SessionId('release-append'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    session.deriveMessages()
    session.releaseCaches()
    userText(session, 'two')
    expect(session.deriveMessages()).toEqual(scratch(session))
  })

  it('returns zero on a session whose caches were never built', () => {
    const session = Session.create(SessionId('release-cold'))
    session.append('turn/start', { turn: 1 })
    expect(session.releaseCaches()).toBe(0)
  })

  it('refolds request context after a release', () => {
    const session = Session.create(SessionId('release-context'))
    session.append('request/context', { provider: 'mock', model: 'mock' })
    const before = session.requestContext()
    session.releaseCaches()
    expect(session.requestContext()).toEqual(before)
  })
})
