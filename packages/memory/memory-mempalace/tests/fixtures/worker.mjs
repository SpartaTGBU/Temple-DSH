import { createInterface } from 'node:readline'
const captures = []
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
function reply(value) { process.stdout.write(JSON.stringify(value) + '\n') }
function graph(request) {
  if (request.payload.startRoom === 'malformed-graph') {
    return { format: 'dsh.memory.graph.v1', nodes: [{ id: 'room:a', kind: 'room', label: 'a', count: 1, isolated: false }], edges: [{ id: 'bad', source: 'room:a', target: 'missing', kind: 'path', count: 1 }], visits: [], truncated: false, stats: { scannedRecords: 1, nodeCount: 1, edgeCount: 1, maxHop: 0 } }
  }
  const nodes = [
    { id: 'room:a', kind: 'room', label: 'a', count: 2, isolated: false },
    { id: 'room:b', kind: 'room', label: 'b', count: 1, isolated: false },
    { id: 'wing:w', kind: 'wing', label: 'w', count: 3, isolated: true },
  ].slice(0, request.payload.maxNodes)
  const ids = new Set(nodes.map(node => node.id))
  const edges = [
    { id: 'path:a:b', source: 'room:a', target: 'room:b', kind: 'path', count: 1 },
    { id: 'placement:a:w', source: 'wing:w', target: 'room:a', kind: 'placement', count: 2 },
    { id: 'placement:b:w', source: 'wing:w', target: 'room:b', kind: 'placement', count: 1 },
  ].filter(edge => ids.has(edge.source) && ids.has(edge.target)).slice(0, request.payload.maxEdges)
  const visits = request.payload.startRoom === undefined ? [] : [
    { nodeId: 'room:a', hop: 0, via: [] },
    ...(request.payload.maxHops > 0 && ids.has('room:b') ? [{ nodeId: 'room:b', hop: 1, parentNodeId: 'room:a', via: ['w'] }] : []),
  ]
  return { format: 'dsh.memory.graph.v1', nodes, edges, visits, truncated: false, stats: { scannedRecords: 3, nodeCount: nodes.length, edgeCount: edges.length, maxHop: visits.at(-1)?.hop ?? 0 } }
}
lines.on('line', line => {
  const request = JSON.parse(line)
  const run = () => {
    if (request.method === 'recall') {
      if (request.payload.query === 'malformed') { process.stdout.write('not-json\n'); return }
      if (request.payload.query === 'oversized-frame') { process.stdout.write('x'.repeat(5000)); return }
      reply({ id: request.id, ok: true, result: { items: [{ text: `memory:${request.payload.query}`, wing: 'w', room: 'r' }], truncated: false } })
      return
    }
    if (request.method === 'graph') { reply({ id: request.id, ok: true, result: graph(request) }); return }
    if (request.method === 'capture') { captures.push(request.payload); reply({ id: request.id, ok: true, result: { captured: true } }); return }
    if (request.method === 'flush') { reply({ id: request.id, ok: true, result: { count: captures.length } }); return }
    if (request.method === 'shutdown') { reply({ id: request.id, ok: true, result: { stopped: true } }); setTimeout(() => process.exit(0), 5); return }
    reply({ id: request.id, ok: false, error: 'unknown method' })
  }
  const delay = request.payload?.query === 'delay' || request.payload?.userText === 'slow' || request.payload?.startRoom === 'delay' ? 300 : 0
  setTimeout(run, delay)
})
