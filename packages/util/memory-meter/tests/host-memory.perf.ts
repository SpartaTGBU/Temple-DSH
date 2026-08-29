/**
 * Host memory benchmark: drive N concurrent long sessions, then compare the
 * memory-meter's estimated retained bytes against the real process RSS/heap
 * delta. Not a correctness gate — a runnable instrument that gives Gap A/C
 * before/after numbers. Run directly:
 *   node --import tsx/esm packages/util/memory-meter/tests/host-memory.perf.ts
 */
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { reportSessionMemory } from '@deepseek-ai/dsh-memory-meter'

const SESSION_COUNT = Number(process.env.BENCH_SESSIONS ?? 200)
const EVENTS_PER_SESSION = Number(process.env.BENCH_EVENTS ?? 400)

function buildSession(index: number): Session {
  const session = Session.create(SessionId(`bench-${index}`))
  for (let turn = 1; turn <= EVENTS_PER_SESSION; turn++) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `turn ${turn} of session ${index}: ${'x'.repeat(200)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
  return session
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function main(): void {
  if (globalThis.gc) globalThis.gc()
  const before = process.memoryUsage()

  const sessions: Session[] = []
  for (let i = 0; i < SESSION_COUNT; i++) sessions.push(buildSession(i))

  if (globalThis.gc) globalThis.gc()
  const after = process.memoryUsage()

  const store = { list: () => sessions }
  const report = reportSessionMemory(store)

  const rssDelta = after.rss - before.rss
  const heapDelta = after.heapUsed - before.heapUsed

  process.stdout.write('=== dsh host memory benchmark ===\n')
  process.stdout.write(`sessions: ${SESSION_COUNT}, events/session: ${EVENTS_PER_SESSION}\n`)
  process.stdout.write(`real RSS delta:       ${mb(rssDelta)}\n`)
  process.stdout.write(`real heapUsed delta:  ${mb(heapDelta)}\n`)
  process.stdout.write(`meter estimate total: ${mb(report.totalRetainedBytes)}\n`)
  process.stdout.write(`meter estimate/session avg: ${mb(report.totalRetainedBytes / SESSION_COUNT)}\n`)
  process.stdout.write(`heap/estimate ratio:  ${(heapDelta / report.totalRetainedBytes).toFixed(2)}x\n`)
  const top = report.sessions[0]
  if (top) process.stdout.write(`costliest session:    ${top.id} = ${mb(top.estimate.retainedBytes)}\n`)
}

main()
