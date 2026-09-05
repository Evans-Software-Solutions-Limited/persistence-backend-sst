import {
  ANDROID_UA_PATTERN,
  BOT_UA_PATTERN,
  IOS_UA_PATTERN,
} from "../marketing/edgeRedirect";

/**
 * Which mobile platform a visitor is on, decided from the user-agent string.
 *
 * The site had no client-side platform sniff at all until now: the only one
 * that existed ran in the `/g/:slug` CloudFront Function, which is a different
 * runtime with no DOM. This is the browser-side counterpart, and it reads the
 * SAME patterns from `edgeRedirect.ts` rather than restating them — an iPhone
 * that scans a QR code and an iPhone that lands on `/meta` must be classified
 * the same way, or a redemption link would appear on one path and not the
 * other for the same handset.
 *
 * `other` is the honest answer for desktop, and it is also what a crawler
 * gets. Crawlers are checked FIRST, exactly as at the edge: Googlebot's
 * smartphone crawler advertises an iPhone user-agent, and an offer redemption
 * link is not something to put in a search index or a link-unfurl card.
 *
 * macOS is deliberately not `ios` — matching the edge's reasoning, an Apple
 * Silicon Mac can run iOS apps but a desktop visitor is better served by the
 * page itself.
 */
export type VisitorPlatform = "ios" | "android" | "other";

function matches(pattern: string, userAgent: string): boolean {
  return new RegExp(pattern, "i").test(userAgent);
}

export function platformFromUserAgent(
  userAgent: string | null | undefined,
): VisitorPlatform {
  if (!userAgent) return "other";
  if (matches(BOT_UA_PATTERN, userAgent)) return "other";
  if (matches(IOS_UA_PATTERN, userAgent)) return "ios";
  if (matches(ANDROID_UA_PATTERN, userAgent)) return "android";
  return "other";
}

/** The current visitor's platform, or `other` outside a browser. */
export function currentPlatform(): VisitorPlatform {
  if (typeof navigator === "undefined") return "other";
  return platformFromUserAgent(navigator.userAgent);
}
