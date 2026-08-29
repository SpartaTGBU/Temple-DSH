# Host memory benchmark runbook

The `dsh-memory-meter` package ships a runnable host memory benchmark that quantifies how much heap the in-memory session store retains, and validates the meter's estimate against the real process footprint. Use it to get a concrete before/after number whenever you change what a session keeps resident (compaction, spill, log tiering, session eviction).

## Run it

```text
node --expose-gc --import tsx/esm packages/util/memory-meter/tests/host-memory.perf.ts
```

`--expose-gc` lets the benchmark force a collection before each measurement so the RSS/heap deltas reflect retained state, not allocator slack. Without it the numbers still print but are noisier.

## Tune the workload

| Env var | Default | Meaning |
|---|---|---|
| `BENCH_SESSIONS` | `200` | Number of concurrent sessions built and held resident |
| `BENCH_EVENTS` | `400` | Events appended per session |

```text
BENCH_SESSIONS=500 BENCH_EVENTS=800 node --expose-gc --import tsx/esm packages/util/memory-meter/tests/host-memory.perf.ts
```

## Read the output

```text
=== dsh host memory benchmark ===
sessions: 200, events/session: 400
real RSS delta:       186.2 MB
real heapUsed delta:  63.3 MB
meter estimate total: 37.6 MB
meter estimate/session avg: 0.2 MB
heap/estimate ratio:  1.68x
costliest session:    bench-100 = 0.2 MB
```

- **real RSS / heapUsed delta** — the actual process growth from holding the sessions.
- **meter estimate total** — the serialized-content-plus-overhead estimate the eviction ranking uses.
- **heap/estimate ratio** — how much more the live object graph costs than serialized bytes; multiply an estimate by this to approximate real heap. Record it per workload before trusting a byte budget.

## Use it for a change

1. Run the benchmark on `master` and record the deltas.
2. Apply your change (for example a session-eviction policy).
3. Re-run with the same `BENCH_SESSIONS`/`BENCH_EVENTS` and compare.
4. Put both numbers in the PR description.
