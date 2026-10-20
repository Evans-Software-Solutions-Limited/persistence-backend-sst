/**
 * Tradedoubler landing tag + sale conversion (Blue Light Card member offer,
 * PER-3). Modelled on `metaPixel.ts`: no SDK package, the vendor's own snippet
 * injected by hand, every entry point a no-op unless the build carries the
 * ids AND the visitor has opted in.
 *
 * ─── What it does ───
 *
 * Blue Light Card sends members here through the Tradedoubler affiliate
 * network. The inbound link carries a `tduid` query param; the landing tag
 * stores it (first-party cookie `TRADEDOUBLER`, plus our own copy in
 * `sessionStorage`) so the sale can later be attributed back to that click.
 * The sale itself is reported twice — server-side by the backend from the
 * Stripe webhook, and here from the thanks page — and Tradedoubler dedupes on
 * the order number (the Stripe Checkout session id).
 *
 * ─── Consent (`affiliate` category) ───
 *
 * Tradedoubler's integration guide is explicit: without consent, do not store
 * the `tduid`. So `captureTduid` reads the param on any call (it must run
 * before a navigation strips it) but WRITES only with consent; `init` and
 * `trackTradedoublerSale` no-op without it; and `teardownTradedoubler` is the
 * withdrawal path — `tdconv('tracking-consent', false)`, the cookie expired,
 * the stored id dropped. The server-side report is deliberately NOT gated
 * here: that is the backend's call, made from its own record of the sale.
 */

import { clearTradedoublerCookies, hasConsent } from "./consent";

type TdconvArgs = unknown[];

interface TdconvFn {
  (...args: TdconvArgs): void;
  q?: TdconvArgs[];
  l?: number;
}

declare global {
  interface Window {
    tdconv?: TdconvFn;
    TDConversionObject?: string;
  }
}

const SDK_SRC = "https://svht.tradedoubler.com/tr_sdk.js";

/** Where the captured click id lives between the landing and the thanks page. */
export const TDUID_STORAGE_KEY = "persistence.tduid";

/** The first-party cookie the Tradedoubler SDK sets from the `tduid`. */
const TRADEDOUBLER_COOKIE = "TRADEDOUBLER";

function orgId(): string {
  return (import.meta.env.VITE_TRADEDOUBLER_ORG_ID ?? "").trim();
}

function programId(): string {
  return (import.meta.env.VITE_TRADEDOUBLER_PROGRAM_ID ?? "").trim();
}

function saleEventId(): string {
  return (import.meta.env.VITE_TRADEDOUBLER_SALE_EVENT_ID ?? "").trim();
}

/** The landing tag needs the organisation and programme ids. */
function isEnabled(): boolean {
  return orgId().length > 0 && programId().length > 0;
}

function isLoaded(): boolean {
  return typeof window !== "undefined" && window.tdconv !== undefined;
}

/**
 * Inject Tradedoubler's landing snippet. No-op without `affiliate` consent,
 * without the ids, or when already injected (idempotent). The snippet is the
 * vendor's verbatim loader with the ids substituted: it defines the `tdconv`
 * command queue, loads `tr_sdk.js` async, and the SDK drains the queue once it
 * is up — so `tdconv('tracking-consent', true)` queued here lands after load.
 * `and=<random>` is the vendor's cache-buster and is kept as given.
 */
export function initTradedoubler(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (!hasConsent("affiliate") || !isEnabled() || isLoaded()) {
    return;
  }

  const tdconv: TdconvFn = function (...args: TdconvArgs) {
    (tdconv.q = tdconv.q ?? []).push(args);
  };
  tdconv.l = Date.now();
  window.TDConversionObject = "tdconv";
  window.tdconv = tdconv;

  const script = document.createElement("script");
  script.async = true;
  script.src = `${SDK_SRC}?org=${encodeURIComponent(orgId())}&prog=${encodeURIComponent(programId())}&dr=true&and=${Math.random()}`;
  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  window.tdconv("tracking-consent", true);
}

function readParamTduid(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tduid");
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read the `tduid` from the current URL and, ONLY with `affiliate` consent,
 * keep it in `sessionStorage` for the checkout request. Call this on mount —
 * before consent has necessarily been given — so the param is seen before any
 * navigation strips it; call it again on consent grant so the id is kept.
 * Returns the param when present, stored or not.
 */
export function captureTduid(): string | null {
  const tduid = readParamTduid();
  if (!tduid) return null;
  if (!hasConsent("affiliate")) return tduid;
  try {
    window.sessionStorage.setItem(TDUID_STORAGE_KEY, tduid);
  } catch {
    // ignore — locked-down storage; the checkout simply sends no tduid.
  }
  return tduid;
}

/** The stored click id, if consent allowed it to be kept. */
export function storedTduid(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage.getItem(TDUID_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function clearStoredTduid(): void {
  try {
    window.sessionStorage.removeItem(TDUID_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function hasTradedoublerCookie(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${TRADEDOUBLER_COOKIE}=`).test(document.cookie);
}

/**
 * Whether this visitor arrived through the affiliate link: a `tduid` on the
 * current URL, one kept from an earlier page in this session, or the cookie
 * the SDK set. Gates the Blue Light Card page.
 */
export function hasAffiliateReferral(): boolean {
  return (
    readParamTduid() !== null ||
    storedTduid() !== undefined ||
    hasTradedoublerCookie()
  );
}

/**
 * Withdraw consent: tell the SDK (if loaded), expire its cookie and drop the
 * stored click id. The script itself cannot be unloaded, so the consent guard
 * on every other entry point keeps it inert until the visitor opts back in.
 */
export function teardownTradedoubler(): void {
  if (isLoaded()) window.tdconv!("tracking-consent", false);
  clearTradedoublerCookies();
  clearStoredTduid();
}

export interface TradedoublerSale {
  /** The order number Tradedoubler dedupes on — the Checkout session id. */
  transactionId: string;
  /** Major units, e.g. 111.99. */
  orderValue: number;
  voucher: string;
  currency: string;
}

/**
 * Report a sale from the browser. No-op without consent, without all three
 * ids, or when the landing tag is not loaded (so a thanks page reached
 * without consent reports nothing — the server copy still does).
 */
export function trackTradedoublerSale(sale: TradedoublerSale): void {
  if (!hasConsent("affiliate") || !isEnabled() || !isLoaded()) return;
  const event = saleEventId();
  if (event.length === 0) return;
  window.tdconv!("init", orgId(), { element: "iframe" });
  window.tdconv!("track", "sale", {
    transactionId: sale.transactionId,
    ordervalue: sale.orderValue,
    voucher: sale.voucher,
    currency: sale.currency,
    event,
  });
}
