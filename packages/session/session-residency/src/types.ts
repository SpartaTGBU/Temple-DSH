
/** One session selected for eviction, with the facts behind the choice. */
export interface EvictionCandidate {
  /** The session identifier (stringified). */
  readonly id: string
  /** The session's estimated retained bytes at selection time. */
  readonly retainedBytes: number
  /** Milliseconds the session had been idle at selection time. */
  readonly idleMs: number
}

/** An ordered set of eviction candidates and their aggregate cost. */
export interface EvictionPlan {
  /** Candidates in eviction order (costliest first), capped per pass. */
  readonly candidates: readonly EvictionCandidate[]
  /** Sum of the candidates' retained bytes. */
  readonly totalRetainedBytes: number
}

/** The mechanism that drops a session's resident state and allows rehydration. */
export interface ResidencyExecutor {
  /**
   * Evict one session: persist and drop its resident state so it can rehydrate
   * on next access. Rejecting leaves the session resident.
   * @param candidate - the session to evict.
   */
  evict(candidate: EvictionCandidate): Promise<void> | void
}

/** Residency policy configuration. */
export interface ResidencyConfig {
  /** Idle milliseconds before a session may be evicted. Defaults to 5 minutes. */
  idleMs?: number
  /** Pressure level at or above which eviction runs. Defaults to 'elevated'. */
  minLevel?: 'elevated' | 'critical'
  /** Maximum sessions evicted in one pass. Defaults to 8. */
  maxEvictionsPerPass?: number
}
