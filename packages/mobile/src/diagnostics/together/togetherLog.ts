import { Share } from "react-native";
import { isSentryEnabled, Sentry } from "@/lib/sentry";

/**
 * What Together did, in order: lobby phases, native calls with their real
 * codes, and every Nearby/LAN SDK callback. Bounded, in memory, no frame
 * contents, no names. Shared from the lobby on non-production builds and
 * attached to crash reports as breadcrumbs, because a failed two-phone run
 * previously left no trace beyond one generic line of copy.
 */
export type TogetherLogEntry = {
  id: number;
  at: number;
  source: string;
  message: string;
  data?: Record<string, unknown>;
};

export interface TogetherLogSink {
  record(source: string, message: string, data?: Record<string, unknown>): void;
}

export const TOGETHER_LOG_CAPACITY = 400;

export class TogetherLog implements TogetherLogSink {
  private readonly entries_: TogetherLogEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  constructor(
    private readonly capacity: number = TOGETHER_LOG_CAPACITY,
    private readonly now: () => number = Date.now,
    private readonly onEntry?: (entry: TogetherLogEntry) => void,
  ) {}

  record(source: string, message: string, data?: Record<string, unknown>) {
    const entry: TogetherLogEntry = {
      id: this.nextId++,
      at: this.now(),
      source,
      message,
      ...(data && Object.keys(data).length ? { data: compact(data) } : {}),
    };
    this.entries_.push(entry);
    if (this.entries_.length > this.capacity) this.entries_.shift();
    try {
      this.onEntry?.(entry);
    } catch {
      /* A reporting sink can never break the lobby. */
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* UI listeners cannot break recording. */
      }
    }
  }

  /** Oldest first; copies so callers cannot mutate the log. */
  entries(): TogetherLogEntry[] {
    return this.entries_.map((e) => ({
      ...e,
      ...(e.data ? { data: { ...e.data } } : {}),
    }));
  }

  clear() {
    this.entries_.length = 0;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** One line per entry: wall clock, offset from the first entry, source, message, data. */
  format(): string {
    const entries = this.entries_;
    if (!entries.length) return "Together log is empty.";
    const origin = entries[0].at;
    return entries
      .map((e) => {
        const offset = `+${String(e.at - origin).padStart(7, " ")}ms`;
        const data = e.data ? ` ${JSON.stringify(e.data)}` : "";
        return `${new Date(e.at).toISOString()} ${offset} [${e.source}] ${e.message}${data}`;
      })
      .join("\n");
  }
}

function compact(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data))
    if (value !== undefined) out[key] = value;
  return out;
}

function breadcrumb(entry: TogetherLogEntry) {
  if (!isSentryEnabled()) return;
  Sentry.addBreadcrumb({
    category: `together.${entry.source}`,
    message: entry.message,
    level: /fail|error|reject/i.test(entry.message) ? "warning" : "info",
    ...(entry.data ? { data: entry.data } : {}),
  });
}

/** The app-wide Together log. Always recorded; only the share action is gated. */
export const togetherLog = new TogetherLog(
  TOGETHER_LOG_CAPACITY,
  Date.now,
  breadcrumb,
);

/** Opens the system share sheet with the formatted log. */
export async function shareTogetherLog(log: TogetherLog = togetherLog) {
  try {
    await Share.share({ message: log.format() });
  } catch {
    // Dismissed share sheets reject on some platforms; nothing to do.
  }
}
