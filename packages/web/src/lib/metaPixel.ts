/**
 * Meta Pixel loader + browser-side event helpers (spec-30 WS3).
 *
 * Loads the pixel only when `VITE_META_PIXEL_ID` is set at build time, so
 * dev/PR previews without the id stay a clean no-op. Injects the standard
 * Meta Pixel base code
 * (https://developers.facebook.com/docs/meta-pixel/get-started) rather than
 * pulling in an SDK, matching the rest of this package's "no new deps"
 * convention.
 *
 * The click-id helpers (`getFbc`/`getFbp`) and `newEventId` back the shared
 * dedup key between this browser pixel and the server-side Meta CAPI client
 * (see `useLeadSubmit.ts`).
 *
 * ⚠ Consent (spec-30 R3.5): the pixel is advertising/measurement, not strictly
 * necessary, so nothing here runs until the visitor has opted in. `init` +
 * `trackPageView` + `trackLead` all no-op unless `getConsent() === "granted"`,
 * so a call at the wrong moment (before consent, or after withdrawal — the
 * script can't be unloaded once injected) can never set a cookie or fire an
 * event. The CAPI server path is intentionally NOT gated by this.
 */

import { clearMetaCookies, getConsent } from "./consent";

type FbqArgs = unknown[];

interface FbqFn {
  (...args: FbqArgs): void;
  callMethod?: (...args: FbqArgs) => void;
  queue: FbqArgs[];
  push: FbqFn;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

const PIXEL_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

function pixelId(): string {
  return (import.meta.env.VITE_META_PIXEL_ID ?? "").trim();
}

function isEnabled(): boolean {
  return pixelId().length > 0;
}

function isLoaded(): boolean {
  return typeof window !== "undefined" && window.fbq !== undefined;
}

/**
 * Inject the Meta Pixel base code + `fbq('init', <id>)`. No-op when consent has
 * not been granted (spec-30 R3.5), when `VITE_META_PIXEL_ID` is unset, or when
 * the pixel has already been injected (idempotent — safe to call more than
 * once). The consent check is at CALL time, not module load, so it always
 * reflects the visitor's latest choice.
 */
export function initMetaPixel(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (getConsent() !== "granted" || !isEnabled() || isLoaded()) {
    return;
  }

  const fbq = function (...args: FbqArgs) {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
    } else {
      fbq.queue.push(args);
    }
  } as unknown as FbqFn;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];

  window.fbq = fbq;
  window._fbq = window._fbq ?? fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = PIXEL_SCRIPT_SRC;
  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  window.fbq("init", pixelId());
}

/**
 * Withdraw consent (spec-30 R3.5): expire `_fbp`/`_fbc`. A loaded `fbevents.js`
 * cannot be unloaded from the page, so this clears its cookies and relies on the
 * consent guard in `initMetaPixel`/`trackPageView`/`trackLead` to keep it inert
 * (no further init, no further events) until the visitor opts back in.
 */
export function teardownMetaPixel(): void {
  clearMetaCookies();
}

/** Fire the standard `PageView` event. No-op without consent or when the pixel
 *  isn't loaded — so a route change after withdrawal fires nothing. */
export function trackPageView(): void {
  if (getConsent() !== "granted" || !isLoaded()) return;
  window.fbq!("track", "PageView");
}

/**
 * Fire a `Lead` event with an explicit `eventID` so Meta dedups it against
 * the server-side CAPI `Lead` sharing the same id (spec-30 R3.2). No-op without
 * consent or when the pixel isn't loaded.
 */
export function trackLead(eventId: string): void {
  if (getConsent() !== "granted" || !isLoaded()) return;
  window.fbq!("track", "Lead", {}, { eventID: eventId });
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Meta click id (`fbc`). Prefers a fresh `fbclid` query param on the current
 * page, formatted per Meta's documented `fbc` shape
 * (`fb.1.<unix_ms>.<fbclid>`); falls back to a previously-set `_fbc` cookie
 * when this page view carries no `fbclid` (e.g. a later page in the same
 * session). Returns `null` when neither is present.
 */
export function getFbc(): string | null {
  if (typeof window !== "undefined") {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid) {
      return `fb.1.${Date.now()}.${fbclid}`;
    }
  }
  return readCookie("_fbc");
}

/**
 * Meta browser id (`fbp`), read straight from the `_fbp` cookie the pixel
 * sets on first load. Returns `null` when the pixel hasn't set it (e.g.
 * pixel unconfigured, or the cookie hasn't landed yet).
 */
export function getFbp(): string | null {
  return readCookie("_fbp");
}

/** A fresh dedup key shared between the browser pixel and the server CAPI call. */
export function newEventId(): string {
  return crypto.randomUUID();
}
