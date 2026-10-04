// events/retryBudget.ts - bounded in-process retry accounting for the seeding consumers.
//
// A handler that THROWS is retried by kafkajs (same message, backoff). That is right for a
// transient fault (database down, token introspection unavailable) and wrong for a poison
// message whose failure is deterministic: it would wedge the partition forever. So each
// message gets a small budget; the attempt that exhausts it is the LAST one, and the handler
// then records a typed `seed.failed` (INTERNAL_ERROR, retryable) instead of throwing, so the
// offset commits and the requester / reconciler is told. In-memory by design: a process
// restart resets it (at worst a few extra attempts), and the map is bounded.

export interface RetryAttempt {
  /** 1-based attempt number for this key. */
  attempt: number;
  /** True when this attempt must not throw (record a failure instead). */
  last: boolean;
}

export class RetryBudget {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly maxKeys = 1000,
  ) {}

  /** Register one more attempt for `key`. */
  next(key: string): RetryAttempt {
    const attempt = (this.seen.get(key) ?? 0) + 1;
    if (!this.seen.has(key) && this.seen.size >= this.maxKeys) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    this.seen.set(key, attempt);
    return { attempt, last: attempt >= this.maxAttempts };
  }

  /** The message was handled (or recorded): forget it. */
  clear(key: string): void {
    this.seen.delete(key);
  }

  get size(): number {
    return this.seen.size;
  }
}
