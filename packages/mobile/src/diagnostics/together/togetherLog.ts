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

/**
 * A native or JS failure code as it may leave the phone. Codes, and the
 * fixed error messages this codebase uses as codes, are letters, digits,
 * spaces and `_ - . :` up to 64 characters; anything else (an email, a
 * token, a long SDK description) is replaced whole, never trimmed to fit.
 */
const SAFE_CODE = /^[A-Za-z0-9 _.:-]{1,64}$/;
export function safeTogetherCode(code: unknown): string {
  if (typeof code !== "string" || !code.trim()) return "unknown";
  return SAFE_CODE.test(code) ? code.trim() : "unrecognised";
}
/**
 * Log fields that may leave the phone. Identifiers (session, lobby, endpoint,
 * peer and device ids), free-text error messages and anything not listed are
 * dropped: what remains is codes, phases, counts, flags and timings.
 */
const SAFE_KEYS = new Set([
  "code",
  "error",
  "phase",
  "requested",
  "selected",
  "found",
  "ms",
  "chars",
  "active",
  "host",
  "known",
  "peers",
  "ready",
  "incoming",
  "valid",
  "accept",
]);
export function safeTogetherData(
  data: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!data) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SAFE_KEYS.has(key)) continue;
    if (typeof value === "number" || typeof value === "boolean")
      out[key] = value;
    else if (typeof value === "string") out[key] = safeTogetherCode(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function breadcrumb(entry: TogetherLogEntry) {
  if (!isSentryEnabled()) return;
  const data = safeTogetherData(entry.data);
  Sentry.addBreadcrumb({
    category: `together.${entry.source}`,
    message: entry.message,
    level: /fail|error|reject/i.test(entry.message) ? "warning" : "info",
    ...(data ? { data } : {}),
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
