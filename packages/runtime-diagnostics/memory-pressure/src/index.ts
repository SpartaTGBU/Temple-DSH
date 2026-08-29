/**
 * Host memory-pressure sampler and capability event.
 *
 * Periodically samples process.memoryUsage() against configured watermarks and
 * publishes the current pressure level on the `runtime/memory-pressure` bus
 * event whenever it changes. Memory-shedding responders (compaction, session
 * residency, spill policy, caches) consume the one signal and each decide how
 * to react; this plugin owns detection only, never a shedding mechanism.
 *
 * @module @deepseek-ai/dsh-memory-pressure
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryPressureConfig, MemoryPressureLevel, MemoryPressureSample } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryPressure: MemoryPressure
  }

  interface Events {
    /**
     * The host memory-pressure level changed. Emitted only on a transition, so
     * a steady state produces no traffic. Responders read the new level and
     * shed proportionally; the sample carries the reading that triggered it.
     * Dispatched synchronously to observers; a throwing listener is contained
     * and never reaches the sampler timer.
     * @param sample - the level and the memory reading that produced it.
     * @mode emit
     */
    'runtime/memory-pressure'(sample: MemoryPressureSample): void
  }
}

/** Default heap-used watermarks (bytes): 1 GiB elevated, 1.5 GiB critical. */
export const DEFAULT_ELEVATED_BYTES = 1024 * 1024 * 1024
export const DEFAULT_CRITICAL_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024)
/** Default sampling interval (ms). */
export const DEFAULT_INTERVAL_MS = 5000

/** Read the process heap-used bytes; overridable for tests. */
export type MemoryReader = () => number

const defaultReader: MemoryReader = () => process.memoryUsage().heapUsed

/**
 * Classify a heap-used reading against the resolved watermarks.
 * @param heapUsedBytes - current heap-used bytes.
 * @param elevated - elevated watermark in bytes.
 * @param critical - critical watermark in bytes.
 * @returns the pressure level for the reading.
 */
export function classifyPressure(heapUsedBytes: number, elevated: number, critical: number): MemoryPressureLevel {
  if (heapUsedBytes >= critical) return 'critical'
  if (heapUsedBytes >= elevated) return 'elevated'
  return 'normal'
}

/** Host memory-pressure detection service (`ctx.memoryPressure`). */
export class MemoryPressure extends Service {
  static Config: z<MemoryPressureConfig> = z.object({
    elevatedBytes: z.number().step(1).min(1).default(DEFAULT_ELEVATED_BYTES),
    criticalBytes: z.number().step(1).min(1).default(DEFAULT_CRITICAL_BYTES),
    intervalMs: z.number().step(1).min(1).default(DEFAULT_INTERVAL_MS),
  })

  private currentLevel: MemoryPressureLevel = 'normal'
  private readonly elevated: number
  private readonly critical: number
  private readonly reader: MemoryReader

  constructor(ctx: Context, config: MemoryPressureConfig = {}, reader: MemoryReader = defaultReader) {
    const elevated = config.elevatedBytes ?? DEFAULT_ELEVATED_BYTES
    const critical = config.criticalBytes ?? DEFAULT_CRITICAL_BYTES
    // Validate before super() registers the service, so a bad config throws
    // without leaving a half-registered service on the context.
    if (critical <= elevated) {
      throw new Error(`MemoryPressureConfig: criticalBytes (${critical}) must exceed elevatedBytes (${elevated})`)
    }
    super(ctx, 'memoryPressure')
    this.elevated = elevated
    this.critical = critical
    this.reader = reader
    const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS

    ctx.effect(() => {
      const timer = setInterval(() => { this.sample() }, intervalMs)
      // Never keep the process alive for sampling alone.
      if (typeof timer.unref === 'function') timer.unref()
      return () => { clearInterval(timer) }
    }, 'memory-pressure: sampler')
  }

  /** The current classified pressure level. */
  get level(): MemoryPressureLevel {
    return this.currentLevel
  }

  /**
   * Take one reading now, publish a transition when the level changed, and
   * return the sample. Exposed so a caller (or a test) can force a sample
   * outside the interval.
   * @returns the sample taken.
   */
  sample(): MemoryPressureSample {
    const heapUsedBytes = this.reader()
    const level = classifyPressure(heapUsedBytes, this.elevated, this.critical)
    const sample: MemoryPressureSample = { level, heapUsedBytes, elevatedBytes: this.elevated, criticalBytes: this.critical }
    if (level !== this.currentLevel) {
      this.currentLevel = level
      this.ctx.emit('runtime/memory-pressure', sample)
    }
    return sample
  }
}

export default MemoryPressure
