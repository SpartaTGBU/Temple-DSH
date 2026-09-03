import { createInterface } from 'node:readline'
const captures = []
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
function reply(value) { process.stdout.write(JSON.stringify(value) + '\n') }
lines.on('line', line => {
  const request = JSON.parse(line)
  const run = () => {
    if (request.method === 'recall') {
      if (request.payload.query === 'malformed') { process.stdout.write('not-json\n'); return }
      reply({ id: request.id, ok: true, result: { items: [{ text: `memory:${request.payload.query}`, wing: 'w', room: 'r' }], truncated: false } })
      return
    }
    if (request.method === 'capture') {
      captures.push(request.payload)
      reply({ id: request.id, ok: true, result: { captured: true } })
      return
    }
    if (request.method === 'flush') { reply({ id: request.id, ok: true, result: { count: captures.length } }); return }
    if (request.method === 'shutdown') { reply({ id: request.id, ok: true, result: { stopped: true } }); setTimeout(() => process.exit(0), 5); return }
    reply({ id: request.id, ok: false, error: 'unknown method' })
  }
  const delay = request.payload?.query === 'delay' || request.payload?.userText === 'slow' ? 300 : 0
  setTimeout(run, delay)
})
