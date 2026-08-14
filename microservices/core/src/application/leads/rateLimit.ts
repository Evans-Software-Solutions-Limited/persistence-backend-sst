/**
 * Best-effort per-IP fixed-window rate limiter for the PUBLIC marketing routes
 * (`/leads/waitlist`, `/leads/coach`, `/store-click`) — spec-30 R3.3, and the
 * Inspector-Brad follow-up on `/store-click` (anonymous forged-conversion +
 * table-inflation vector).
 *
 * ⚠ Honest scope: this is in-memory, so it is PER Lambda CONTAINER. Under
 * scale-out an attacker fanning across warm containers gets `limit × containers`
 * and a cold start resets the window. It is a real first line against a naive
 * single-IP script (and pairs with the honeypot + bounded input), NOT a
 * WAF-grade defence. Proper per-IP limiting is impossible to bolt onto this
 * HTTP API directly — AWS WAF attaches to REST APIs / CloudFront, not
 * ApiGatewayV2 — so the durable hardening is CloudFront + a WAF rate-based rule,
 * tracked as a follow-up. This ships with zero infra and zero dependencies.
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

/**
 * Hard cap on tracked keys so a spray of unique spoofed IPs can't grow the map
 * unbounded. When exceeded we clear wholesale (crude, but this is a fixed-window
 * best-effort limiter — a dropped window just means the next request starts a
 * fresh count, which fails OPEN, matching the "first line, not a wall" intent).
 */
const MAX_KEYS = 20_000;

/**
 * Record a hit for `key` and report whether it has now EXCEEDED `limit` within
 * the current `windowMs` window. `now` is injectable for deterministic tests.
 */
export function rateLimitExceeded(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const existing = windows.get(key);
  if (existing === undefined || now >= existing.resetAt) {
    if (windows.size >= MAX_KEYS) windows.clear();
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > limit;
}

/**
 * The client IP for rate-limit keying: the FIRST entry in `X-Forwarded-For`
 * (API Gateway appends the caller's IP). Falls back to a shared `"unknown"`
 * bucket when the header is absent — conservative (unknown callers share one
 * budget) rather than unlimited.
 */
export function clientIp(xForwardedFor: string | undefined): string {
  if (typeof xForwardedFor !== "string" || xForwardedFor.length === 0) {
    return "unknown";
  }
  const first = xForwardedFor.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

/** Test-only: clear all windows between cases. */
export function resetRateLimits(): void {
  windows.clear();
}
