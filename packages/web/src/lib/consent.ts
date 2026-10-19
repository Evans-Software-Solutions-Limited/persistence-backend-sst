/**
 * Marketing-cookie consent store (spec-30 R3.5). Dependency-free — no consent
 * SDK, no new packages.
 *
 * ─── Category model (not a single yes/no) ───
 *
 * Consent is stored per NON-ESSENTIAL category so the site can add cookies later
 * without silently reusing an old, narrower "yes" — GDPR requires consent to be
 * specific + informed, so a blanket accept can't retroactively cover a category
 * the visitor was never shown. Strictly-necessary cookies (theme, Turnstile) are
 * always allowed and are NOT represented here.
 *
 * Today there are two non-essential categories: `advertising` (the Meta Pixel)
 * and `affiliate` (the Tradedoubler landing tag + `TRADEDOUBLER` cookie, which
 * lets Blue Light Card count the sign-ups it sent us). Adding e.g. `analytics`
 * later is just a new key on `ConsentChoices` + a row in the banner's Manage
 * panel — and a `CONSENT_VERSION` bump (below).
 *
 * ─── The version is the scope-creep guard ───
 *
 * A stored record from a different `CONSENT_VERSION` is treated as UNDECIDED, so
 * the banner re-appears and re-asks. Bump `CONSENT_VERSION` whenever the set of
 * categories (or their meaning) changes, so a new cookie can never be covered by
 * a stale consent the visitor gave before it existed.
 *
 * ─── Fail-safe ───
 *
 * Every storage access is guarded and the ONLY safe failure is toward "no
 * consent" (all categories off) — never toward granted. Safari private mode
 * throws on `localStorage`; a corrupt/al old-version value reads as undecided.
 */

/** Non-essential consent categories. Extend this as new cookies are added. */
export type ConsentCategory = "advertising" | "affiliate";

export interface ConsentChoices {
  /** Meta Pixel (`_fbp`/`_fbc`) — ad-conversion measurement. */
  advertising: boolean;
  /** Tradedoubler (`TRADEDOUBLER` cookie, stored `tduid`) — affiliate
   *  measurement for the Blue Light Card member offer. */
  affiliate: boolean;
}

/**
 * Bump when the categories (or their meaning) change — this invalidates every
 * stored consent from an earlier version and re-prompts, so a newly-added cookie
 * is never silently covered by an older, narrower "Accept".
 */
export const CONSENT_VERSION = 3;

// The key suffix tracks the version: a v2 record (advertising only) must read
// as undecided under v3, which the `v` check below already guarantees — the
// separate key simply keeps the old record from being misread at all.
const STORAGE_KEY = "persistence.consent.v3";

/** All non-essential categories off — the safe default and failure state. */
const NONE: ConsentChoices = { advertising: false, affiliate: false };

interface StoredConsent {
  v: number;
  advertising: boolean;
  affiliate: boolean;
}

type Listener = (choices: ConsentChoices) => void;
const listeners = new Set<Listener>();

/**
 * The stored choices, or `null` when the visitor has not decided under the
 * CURRENT version (no record, corrupt JSON, or an older-version record — all of
 * which must re-prompt). Never throws.
 */
function readStored(): ConsentChoices | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent> | null;
    if (!parsed || parsed.v !== CONSENT_VERSION) return null;
    return {
      advertising: parsed.advertising === true,
      affiliate: parsed.affiliate === true,
    };
  } catch {
    return null;
  }
}

/** True once the visitor has made a choice under the current version. Drives
 *  whether the banner shows. A storage failure reads as "not decided". */
export function isConsentDecided(): boolean {
  return readStored() !== null;
}

/** The visitor's current choices; all-off when undecided or on any failure. */
export function getChoices(): ConsentChoices {
  return readStored() ?? { ...NONE };
}

/** Whether a specific non-essential category is consented. Fail-safe false. */
export function hasConsent(category: ConsentCategory): boolean {
  return getChoices()[category] === true;
}

/**
 * Persist an explicit set of choices and notify subscribers. A storage failure
 * is swallowed — the in-memory notification still fires so the current page
 * reacts. Always stamps the current `CONSENT_VERSION`.
 */
export function setConsent(choices: ConsentChoices): void {
  const value: StoredConsent = {
    v: CONSENT_VERSION,
    advertising: choices.advertising === true,
    affiliate: choices.affiliate === true,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore — private mode / disabled storage; the notify below still runs.
  }
  const emitted: ConsentChoices = {
    advertising: value.advertising,
    affiliate: value.affiliate,
  };
  for (const fn of listeners) fn(emitted);
}

/** Subscribe to consent changes. Returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Expire the named cookies on the current host and on each parent domain (a
 * third-party tag sets its cookie on the registrable domain, e.g.
 * `.evans-software-solutions.com`, so a host-only delete would miss it). Used
 * when a category's consent is withdrawn — an injected script can't be
 * unloaded, so clearing its cookies is how "withdrawal" is enforced.
 */
function expireCookies(names: readonly string[]): void {
  if (typeof document === "undefined" || typeof location === "undefined")
    return;
  const past = "Thu, 01 Jan 1970 00:00:00 GMT";
  const parts = location.hostname.split(".");
  // "" = host-only (no Domain attribute); then each parent suffix as `.a.b.c`.
  const domainAttrs = [""];
  for (let i = 0; i < parts.length - 1; i++) {
    domainAttrs.push(`; Domain=.${parts.slice(i).join(".")}`);
  }
  for (const name of names) {
    for (const domain of domainAttrs) {
      try {
        document.cookie = `${name}=; Path=/; Expires=${past}${domain}`;
      } catch {
        // ignore — malformed domain candidate; the others still apply.
      }
    }
  }
}

/** Expire Meta's `_fbp` and `_fbc` — advertising consent withdrawn. */
export function clearMetaCookies(): void {
  expireCookies(["_fbp", "_fbc"]);
}

/** Expire Tradedoubler's `TRADEDOUBLER` cookie — affiliate consent withdrawn.
 *  The stored `tduid` is cleared by `teardownTradedoubler` in
 *  `lib/tradedoubler.ts`, which owns that key. */
export function clearTradedoublerCookies(): void {
  expireCookies(["TRADEDOUBLER"]);
}
