import { afterEach, describe, expect, it } from "vitest";
import { clientIp, rateLimitExceeded, resetRateLimits } from "../rateLimit";

afterEach(() => resetRateLimits());

describe("rateLimitExceeded", () => {
  it("allows exactly `limit` hits then reports exceeded", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimitExceeded("k", 3, 60_000, now)).toBe(false);
    }
    // The 4th hit within the window has now exceeded the limit of 3.
    expect(rateLimitExceeded("k", 3, 60_000, now)).toBe(true);
    expect(rateLimitExceeded("k", 3, 60_000, now)).toBe(true);
  });

  it("resets the count once the window elapses", () => {
    const start = 5_000_000;
    for (let i = 0; i < 3; i++) rateLimitExceeded("k", 3, 60_000, start);
    expect(rateLimitExceeded("k", 3, 60_000, start)).toBe(true);

    // At exactly resetAt (start + windowMs) the window has rolled over.
    expect(rateLimitExceeded("k", 3, 60_000, start + 60_000)).toBe(false);
    // ...and a fresh budget is available.
    for (let i = 0; i < 2; i++) {
      expect(rateLimitExceeded("k", 3, 60_000, start + 60_000)).toBe(false);
    }
  });

  it("keys independently per bucket", () => {
    const now = 2_000_000;
    for (let i = 0; i < 3; i++) rateLimitExceeded("a", 3, 60_000, now);
    expect(rateLimitExceeded("a", 3, 60_000, now)).toBe(true);
    // A different key is untouched.
    expect(rateLimitExceeded("b", 3, 60_000, now)).toBe(false);
  });

  it("evicts wholesale (fails open) once MAX_KEYS distinct keys are tracked", () => {
    const now = 3_000_000;
    // 20_000 distinct keys fill the map to the cap.
    for (let i = 0; i < 20_000; i++) {
      rateLimitExceeded(`key-${i}`, 1, 60_000, now);
    }
    // key-0 is at its limit (1 hit) → the next hit would exceed...
    // but the 20_001st distinct key trips the wholesale clear, so afterwards
    // key-0 starts a fresh window rather than staying capped.
    rateLimitExceeded("overflow-key", 1, 60_000, now);
    expect(rateLimitExceeded("key-0", 1, 60_000, now)).toBe(false);
  });

  it("defaults `now` to the wall clock when omitted", () => {
    // Two immediate hits at limit 1: the first seeds the window, the second
    // exceeds it — proves the default-Date.now() path runs without throwing.
    expect(rateLimitExceeded("wall", 1, 60_000)).toBe(false);
    expect(rateLimitExceeded("wall", 1, 60_000)).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop of X-Forwarded-For and trims it", () => {
    expect(clientIp("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe(
      "203.0.113.7",
    );
    expect(clientIp("  198.51.100.2  ")).toBe("198.51.100.2");
  });

  it("falls back to a shared 'unknown' bucket for absent/blank headers", () => {
    expect(clientIp(undefined)).toBe("unknown");
    expect(clientIp("")).toBe("unknown");
    expect(clientIp("   ")).toBe("unknown");
    expect(clientIp(", 70.41.3.18")).toBe("unknown");
  });
});
