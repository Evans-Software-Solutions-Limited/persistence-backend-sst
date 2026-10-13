/**
 * Bounds the number of HTTP requests the API client keeps in flight.
 *
 * A cold start mounts many hooks in one commit and each one fetches at once.
 * The API edge answers the overflow with 503 before the handler runs (Lambda
 * throttling), so the client never lets more than `max` requests out at a
 * time; the rest wait their turn in FIFO order. A request that is aborted by
 * its own timeout while waiting still releases its slot.
 */
export class RequestLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1)
      throw new Error("RequestLimiter requires a positive integer limit");
  }

  /** Number of requests currently running. */
  get inFlight(): number {
    return this.active;
  }

  /** Number of requests waiting for a slot. */
  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw abortError();
    if (this.active >= this.max) await this.wait(signal);
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private wait(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiting.push(grant);
    });
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** Enough for a screen's worth of parallel reads without tripping the edge. */
export const MAX_IN_FLIGHT_REQUESTS = 6;
