/** Host memory-pressure level, from lowest to highest. */
export type MemoryPressureLevel = 'normal' | 'elevated' | 'critical'

/** One memory-pressure reading and its classification. */
export interface MemoryPressureSample {
  /** The classified pressure level for this reading. */
  readonly level: MemoryPressureLevel
  /** The heap-used bytes read. */
  readonly heapUsedBytes: number
  /** The elevated watermark in effect (bytes). */
  readonly elevatedBytes: number
  /** The critical watermark in effect (bytes). */
  readonly criticalBytes: number
}

/** Watermark and interval configuration for the memory-pressure sampler. */
export interface MemoryPressureConfig {
  /** Heap-used bytes at or above which pressure is elevated. Defaults to 1 GiB. */
  elevatedBytes?: number
  /** Heap-used bytes at or above which pressure is critical. Defaults to 1.5 GiB. Must exceed elevatedBytes. */
  criticalBytes?: number
  /** Sampling interval in milliseconds. Defaults to 5000. */
  intervalMs?: number
}
