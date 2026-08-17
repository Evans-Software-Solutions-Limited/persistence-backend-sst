import {
  CAMPAIGNS,
  appStore,
  appStoreUrl,
  playStore,
  playStoreUrl,
} from "./config";

/**
 * The decision behind `GET /g/<slug>` — the short link a printed QR code
 * encodes. An iPhone that scans it goes straight to the App Store with this
 * campaign's attribution; everyone else goes to the campaign's landing page on
 * the marketing site.
 *
 * ─── Why this lives in `packages/web` and not in `infra/` ───
 *
 * There is no server. `packages/web` deploys as `sst.aws.StaticSite` — S3
 * behind CloudFront — so `/g/:slug` cannot be a route; it runs as a CloudFront
 * Function at the edge (see `infra/web.ts`). CloudFront Functions run a
 * restricted runtime with no modules and no `require`, so the function body is
 * generated at SYNTH time from this module — see `edgeRedirectSource.ts`.
 *
 * `infra/` has neither typecheck nor tests, so anything that lived there would
 * be provably correct only by deploying it. Everything that can be decided
 * lives here instead, under `packages/web`'s vitest, and infra is left holding
 * nothing but the CloudFront wiring.
 *
 * ─── One source of truth for `ct` ───
 *
 * The `ct` a QR scan produces has to equal the `ct` the web CTA produces for
 * the same slug, or App Analytics splits one campaign across two tokens. Both
 * come from {@link appStoreUrl}, which reads `CAMPAIGNS` — no slug or token is
 * retyped anywhere in this file or in the generated function.
 */

/** Path prefix the CloudFront behaviours are bound to. */
export const EDGE_REDIRECT_PREFIX = "g";

/**
 * `CAMPAIGNS` keys that are NOT reachable as `/g/<slug>`.
 *
 * `default` is the catch-all `/qr/:slug` attribution bucket, not a channel of
 * its own — it has no landing route, so `/g/default` is treated as an unknown
 * slug and lands on `/` like any other typo.
 */
const RESERVED_SLUGS = ["default"];

/**
 * User-agent patterns, as RegExp source strings rather than literals: the
 * generated CloudFront function interpolates these into its own regex literals,
 * so the edge and the tests below match on byte-identical patterns.
 */

/**
 * Crawlers and link-preview fetchers. Checked FIRST and always sent to the
 * landing page, for two reasons: Googlebot's smartphone crawler advertises an
 * iPhone user-agent (so without this, `/g/flyer` would resolve to an
 * apps.apple.com URL in Google's index), and a WhatsApp/Facebook link unfurl
 * wants the landing page's OG card, not a store redirect.
 *
 * Matching `bot` needs care, because it is a substring of the Android phone
 * brand "CUBOT", whose model strings appear in the wild as `CUBOT_X30`,
 * `CUBOT NOTE 20`, and bare `CUBOT` — so `bot` followed by `_`, a space, `)` or
 * `;` are all REAL handsets. A `bot\b` boundary catches three of those four.
 *
 * So the generic form accepted here is `bot/` alone — crawlers carry a version
 * (`Googlebot/2.1`, `Applebot/0.1`, `SemrushBot/7~bl`) — plus `bot.html`, the
 * documentation URL almost every crawler puts in its `+http://…` comment, plus
 * an explicit list of the ones worth naming. Erring this way is safe in the one
 * direction that matters: an unnamed crawler we miss lands on the landing page
 * or the store, but no real handset is ever mistaken for a crawler.
 *
 * Deliberately absent, because each is a REAL user in an in-app browser rather
 * than a crawler: bare `pinterest` (`Pinterest for Android`) and bare `yandex`
 * (`YandexSearch`). Both crawlers are still caught — Pinterest's by `bot.html`,
 * Yandex's by name.
 */
export const BOT_UA_PATTERN =
  "(bot\\/|bot\\.html|storebot|googlebot|bingbot|applebot|yandexbot|duckduckbot|baiduspider|petalbot|twitterbot|discordbot|telegrambot|slackbot|slack-imgproxy|linkedinbot|crawler|crawl\\b|spider|slurp|bingpreview|facebookexternalhit|embedly|whatsapp|curl\\/|wget|python-requests|okhttp|headlesschrome)";

/**
 * iOS. macOS is deliberately absent: an Apple Silicon Mac can run iOS apps,
 * but a desktop visitor is far better served by the landing page. That also
 * means an iPad in Safari's desktop mode (which reports `Macintosh; Intel Mac
 * OS X`, indistinguishable from a Mac) gets the landing page — accepted.
 */
export const IOS_UA_PATTERN = "(iphone|ipad|ipod)";

/** Android. Only consulted once the Play listing is live — see below. */
export const ANDROID_UA_PATTERN = "android";

/** Where one slug sends each class of viewer. `null` → use `landing`. */
export interface RedirectTargets {
  /** Absolute App Store URL carrying `pt`/`ct`/`mt`, or `null` if iOS should land on the site. */
  ios: string | null;
  /** Absolute Play URL carrying `utm_source`/`utm_campaign`, or `null` while Android isn't live. */
  android: string | null;
  /** Site-relative landing path that decorates its own CTAs with this slug's `ct`. */
  landing: string;
}

export interface RedirectTable {
  slugs: Record<string, RedirectTargets>;
  /** Where an unknown slug — or a bare `/g` — goes. */
  fallbackLanding: string;
}

export interface RedirectDecision {
  status: number;
  /** Site-relative path or absolute store URL for the `location` header. */
  location: string;
}

/**
 * Resolves every slug's destinations once, at synth time.
 *
 * `android` is gated on `playStore.available`, which is `false` while the Play
 * listing is in review: a Play URL on a printed leaflet today would be a dead
 * link, so Android gets the landing page until the flag flips — at which point
 * every printed QR starts routing Android to Play with no artwork reprint. No
 * Play URL is hardcoded here "ready for later"; it comes from `playStore.url`.
 *
 * `landing` is site-RELATIVE (`/flyer`, not an absolute URL) so the same
 * function body is correct on staging, on production and on a personal dev
 * stage, with no per-stage domain wiring — a relative `Location` is resolved
 * against the request URL by every HTTP client (RFC 7231 §7.1.2).
 */
export function buildRedirectTable(): RedirectTable {
  const slugs: Record<string, RedirectTargets> = {};
  for (const slug of Object.keys(CAMPAIGNS)) {
    if (RESERVED_SLUGS.indexOf(slug) !== -1) continue;
    // The ways to add a CAMPAIGNS entry and get a silently dead QR code, all of
    // which the parity tests are structurally blind to because BOTH twins would
    // agree on `/`:
    //   - upper case (`UoN26`) — both twins lower-case the URI before lookup
    //   - a slash (`a/b`) — both split the path before decoding, so `/g/a%2Fb`
    //     never resolves
    //   - a space or non-ASCII (`open day`, `café`) — reachable, but the slug
    //     becomes a `Location` header value, so the redirect is malformed
    // `CAMPAIGNS` is meant to be the only file touched to add a printed asset,
    // so the constraint is enforced here, at synth, where it is broken — not
    // left to be discovered on 5,000 leaflets.
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error(
        `Campaign slug "${slug}" must match /^[a-z0-9-]+$/: /g/<slug> lower-cases and splits the URI before lookup, and the slug becomes a landing path in a Location header, so anything else is either unreachable from a printed QR code or a malformed redirect.`,
      );
    }
    slugs[slug] = {
      ios: appStore.available ? appStoreUrl(slug) : null,
      android: playStore.available ? playStoreUrl(slug) : null,
      landing: `/${slug}`,
    };
  }
  return { slugs, fallbackLanding: "/" };
}

/**
 * Extracts the slug from a `/g/...` path. `/g` and `/g/` yield `""`, which
 * resolves to the fallback rather than falling through to S3 — a printed QR
 * that 404s is unrecoverable.
 *
 * Case-insensitive in the PREFIX as well as the slug: CloudFront path patterns
 * are case-sensitive, so `/G/flyer` is matched by its own pair of behaviours
 * (see `infra/web.ts`) and has to resolve here too, or it would answer `/`
 * instead of `/flyer`.
 *
 * `notEmpty` rather than `filter(Boolean)`: `Boolean` is not in the documented
 * global set for the `cloudfront-js-2.0` runtime the generated twin of this
 * function runs on, and an unbound global there is a 502 on every scan.
 */
export function slugFromPath(pathname: string): string {
  const notEmpty = (segment: string) => segment !== "";
  const parts = pathname.toLowerCase().split("/").filter(notEmpty);
  if (parts.length < 2 || parts[0] !== EDGE_REDIRECT_PREFIX) return "";
  let slug = parts[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Malformed percent-encoding: match on the raw segment, which simply won't
    // be a known slug, so the viewer gets the fallback landing page.
  }
  // Lowercased again AFTER decoding, not only before: `%46` decodes to an
  // upper-case `F`, so `/g/%46lyer` would otherwise miss the table and lose the
  // campaign despite naming a real slug.
  return slug.toLowerCase();
}

function matches(pattern: string, userAgent: string): boolean {
  return new RegExp(pattern, "i").test(userAgent);
}

export interface ResolveOptions {
  /**
   * The request's query string, with or without a leading `?`. Forwarded onto a
   * LANDING destination and dropped on a store destination.
   *
   * This exists for `fbclid`. Meta appends its click id to any link it serves,
   * and the pixel on the landing page seeds `_fbc` from it — so dropping the
   * query string here would fire an unmatched PageView for every `/g/social`,
   * `/g/ig`, `/g/tt` and `/g/li` that travels through an ad or a post. Apple
   * reads only `pt`/`ct`/`mt`, so the store URL is left exactly as generated.
   */
  search?: string;
  /** Injectable so tests can exercise a Play-live table without mutating shared config. */
  table?: RedirectTable;
}

function withSearch(location: string, search: string): string {
  // Landing paths only — never append to an absolute store URL.
  if (!search || location.charAt(0) !== "/") return location;
  const query = search.charAt(0) === "?" ? search.slice(1) : search;
  if (!query) return location;
  // Always `?`: every landing path is `/<slug>` or `/`, so none carries a query
  // of its own. Asserted in the tests rather than branched on here, so the edge
  // twin has no dead branch to keep in step.
  return `${location}?${query}`;
}

/**
 * The whole decision. Always a 302 — never a 404, and never the origin.
 *
 * An unknown slug goes to `/` for EVERY viewer, iOS included: it means a QR we
 * never issued, so there is no campaign to attribute and no reason to push an
 * unattributed install. `/` still carries a live App Store CTA.
 */
export function resolveRedirect(
  pathname: string,
  userAgent: string,
  { search = "", table = buildRedirectTable() }: ResolveOptions = {},
): RedirectDecision {
  const slug = slugFromPath(pathname);
  // hasOwnProperty, not `in`/direct indexing: `slugs` is a plain object, so
  // `/g/constructor` would otherwise resolve to an inherited member.
  const entry = Object.prototype.hasOwnProperty.call(table.slugs, slug)
    ? table.slugs[slug]
    : null;
  let location = entry ? entry.landing : table.fallbackLanding;

  const ua = userAgent || "";
  if (matches(BOT_UA_PATTERN, ua)) {
    // Crawler or unfurler — landing page, already set.
  } else if (entry && entry.ios && matches(IOS_UA_PATTERN, ua)) {
    location = entry.ios;
  } else if (entry && entry.android && matches(ANDROID_UA_PATTERN, ua)) {
    location = entry.android;
  }

  return { status: 302, location: withSearch(location, search) };
}
