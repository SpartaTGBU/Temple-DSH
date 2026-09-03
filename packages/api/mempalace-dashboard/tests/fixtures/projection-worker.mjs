import { parentPort, workerData } from 'node:worker_threads'

if (workerData.options.source.palacePath === 'exit') process.exit(0)

// Timeout and disposal tests deliberately retain this worker event loop.
setInterval(() => {}, 1000)
parentPort.unref()
