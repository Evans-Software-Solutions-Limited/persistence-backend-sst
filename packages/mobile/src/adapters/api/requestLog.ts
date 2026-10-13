/**
 * The last requests the API client made: method, path, status and timing.
 *
 * Bounded, in memory, no bodies or headers. Read by the hidden request-log
 * screen on non-production builds to see exactly what a cold start sends,
 * which the device logs cannot show because they redact URLs.
 */
export type RequestLogEntry = {
  id: number;
  method: string;
  path: string;
  startedAt: number;
  endedAt: number | null;
  status: number | null;
  error: string | null;
};

export const REQUEST_LOG_CAPACITY = 100;

export class RequestLog {
  private readonly entries_: RequestLogEntry[] = [];
  private nextId = 1;

  constructor(
    private readonly capacity: number = REQUEST_LOG_CAPACITY,
    private readonly now: () => number = Date.now,
  ) {}

  start(method: string, path: string): number {
    const id = this.nextId++;
    this.entries_.push({
      id,
      method,
      path,
      startedAt: this.now(),
      endedAt: null,
      status: null,
      error: null,
    });
    if (this.entries_.length > this.capacity) this.entries_.shift();
    return id;
  }

  end(id: number, status: number | null, error?: unknown): void {
    const entry = this.entries_.find((e) => e.id === id);
    if (!entry) return;
    entry.endedAt = this.now();
    entry.status = status;
    entry.error =
      error === undefined
        ? null
        : error instanceof Error
          ? error.name === "AbortError"
            ? "aborted"
            : error.message || error.name
          : String(error);
  }

  /** Oldest first; copies so callers cannot mutate the log. */
  entries(): RequestLogEntry[] {
    return this.entries_.map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries_.length = 0;
  }

  /** Runs `work` with start/end recorded, whatever the outcome. */
  async track<T extends { status: number }>(
    method: string,
    path: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const id = this.start(method, path);
    try {
      const response = await work();
      this.end(id, response.status);
      return response;
    } catch (error) {
      this.end(id, null, error);
      throw error;
    }
  }
}
