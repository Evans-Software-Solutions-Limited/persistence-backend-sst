/**
 * Marketing-cookie consent store (spec-30 R3.5). Dependency-free — no consent
 * SDK, no new packages.
 *
 * Governs ONLY the Meta Pixel (an advertising/measurement cookie, not strictly
 * necessary, so PECR reg 6 requires prior opt-in). The theme preference and the
 * Turnstile challenge are strictly-necessary / user-initiated and are NOT gated
 * by this. The server-side Meta CAPI path is deliberately out of scope here
 * (separate lawful basis — Brad decision).
 *
 * Default is "unset" → the pixel never loads until the visitor explicitly opts
 * in. Every storage access is guarded: Safari private mode throws on
 * `localStorage`, and the ONLY safe way to fail is toward "no consent" (pixel
 * off), never toward "granted".
 *
 * The key is versioned so a materially different consent ask later re-prompts
 * rather than silently inheriting a stale answer.
 */

export type ConsentState = "granted" | "denied" | "unset";

const STORAGE_KEY = "persistence.consent.marketing.v1";

type Listener = (state: ConsentState) => void;
const listeners = new Set<Listener>();

/** Current stored consent. Any storage failure degrades to "unset" (pixel off). */
export function getConsent(): ConsentState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "granted" || raw === "denied" ? raw : "unset";
  } catch {
    return "unset";
  }
}

/** Persist an explicit choice and notify subscribers. A storage failure is
 *  swallowed — the in-memory notification still fires so the current page reacts. */
export function setConsent(next: "granted" | "denied"): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — private mode / disabled storage; the notify below still runs.
  }
  for (const fn of listeners) fn(next);
}

/** Subscribe to consent changes. Returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Expire Meta's `_fbp` and `_fbc` cookies on the current host and on each parent
 * domain (the pixel sets them on the registrable domain, e.g.
 * `.evans-software-solutions.com`, so a host-only delete would miss them). Used
 * on reject/withdrawal — the script itself can't be unloaded once injected, so
 * clearing its cookies is how "withdrawal" is enforced.
 */
export function clearMetaCookies(): void {
  if (typeof document === "undefined" || typeof location === "undefined")
    return;
  const past = "Thu, 01 Jan 1970 00:00:00 GMT";
  const parts = location.hostname.split(".");
  // "" = host-only (no Domain attribute); then each parent suffix as `.a.b.c`.
  const domainAttrs = [""];
  for (let i = 0; i < parts.length - 1; i++) {
    domainAttrs.push(`; Domain=.${parts.slice(i).join(".")}`);
  }
  for (const name of ["_fbp", "_fbc"]) {
    for (const domain of domainAttrs) {
      try {
        document.cookie = `${name}=; Path=/; Expires=${past}${domain}`;
      } catch {
        // ignore — malformed domain candidate; the others still apply.
      }
    }
  }
}
