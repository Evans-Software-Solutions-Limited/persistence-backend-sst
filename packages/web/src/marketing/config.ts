/**
 * Marketing-site config in one place.
 *
 * App Store: LIVE since 15 Aug 2026. Every "get the app" CTA reads from here,
 * so flipping `available` un-inerts all of them at once — `AppStoreCta` stops
 * rendering a `<span aria-disabled>` and renders a real `<a>`, which is what
 * lets `reportStoreClick()` fire at all.
 *
 * `url` is deliberately the storefront-agnostic short form rather than the
 * `/gb/…` URL App Store Connect shows: Apple geo-redirects `apps.apple.com/app/id<id>`
 * to the visitor's own storefront, and the app ships in 175 territories, so a
 * hardcoded `/gb/` would send everyone to the UK store.
 *
 * `appId` also unlocks a live rating badge via Apple's public iTunes Lookup API
 * (https://itunes.apple.com/lookup?id=<appId> → averageUserRating), which can
 * then replace the static proof chips in the hero.
 */
export const appStore = {
  available: true as boolean,
  url: "https://apps.apple.com/app/id6755091280" as string | null,
  appId: "6755091280" as string | null,
};

/**
 * Play Store: mirrors `appStore` above — the Android app isn't live yet
 * either, so every "get the app" CTA that targets Android stays in the
 * non-linking "coming soon" state until `available` flips to `true` and
 * `url` is filled in.
 */
export const playStore = {
  available: false as boolean,
  url: null as string | null,
};

/**
 * Per-campaign attribution tokens, keyed by the landing-route slug
 * (`/uon`, `/flyer`, `/qr/:slug`). `ct`/`pt` are Apple App Store Connect's
 * campaign tokens (surfaced in App Analytics); `utm_source`/`utm_campaign`
 * are the referrer params the Play Console attributes installs by. Adding a
 * new printed/QR asset is one new entry here — no other code changes.
 * `default` is the fallback used by any `/qr/:slug` whose slug isn't (yet)
 * a distinct entry of its own.
 */
export interface Campaign {
  ct?: string;
  pt?: string;
  utm_source?: string;
  utm_campaign?: string;
}

export const CAMPAIGNS: Record<string, Campaign> = {
  uon: { ct: "uon", pt: "uon_campus", utm_source: "uon", utm_campaign: "campus" },
  flyer: {
    ct: "flyer",
    pt: "flyer_print",
    utm_source: "flyer",
    utm_campaign: "print",
  },
  default: { ct: "qr", pt: "qr", utm_source: "qr", utm_campaign: "qr" },
};

function appendParams(
  baseUrl: string,
  params: Record<string, string | undefined>,
): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  if (entries.length === 0) return baseUrl;
  const search = new URLSearchParams(entries);
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${search.toString()}`;
}

/**
 * App Store CTA URL. With a known `campaign` slug, appends Apple's `ct`/`pt`
 * campaign tokens; with no campaign, returns the bare store URL. Returns
 * `null` when the store isn't live yet (`appStore.url` is `null`) — there is
 * nothing to link to regardless of campaign.
 *
 * NOTE: this decoration activates automatically the moment `appStore`
 * flips `available: true` with a real `url` — Home's existing CTAs don't
 * pass a campaign yet (follow-up once the store is live), so nothing here
 * changes today's rendered output.
 */
export function appStoreUrl(campaign?: string): string | null {
  if (!appStore.url) return null;
  if (!campaign) return appStore.url;
  const c = CAMPAIGNS[campaign];
  if (!c) return appStore.url;
  return appendParams(appStore.url, { ct: c.ct, pt: c.pt });
}

/**
 * Play Store CTA URL — see {@link appStoreUrl}; uses `utm_source`/
 * `utm_campaign` instead of Apple's `ct`/`pt`. Returns `null` when
 * `playStore.url` is `null` (not live yet).
 */
export function playStoreUrl(campaign?: string): string | null {
  if (!playStore.url) return null;
  if (!campaign) return playStore.url;
  const c = CAMPAIGNS[campaign];
  if (!c) return playStore.url;
  return appendParams(playStore.url, {
    utm_source: c.utm_source,
    utm_campaign: c.utm_campaign,
  });
}

/**
 * Hero phone screenshot. Null → the pure-CSS app mock renders in the tilting
 * frame. When real screenshots are ready, drop the image in `public/` and set
 * this to its path (e.g. "/hero-screenshot.png", ideally a 9:19.5 portrait
 * capture) — it renders inside the same hover-tilt frame, no other changes.
 */
export const heroScreenshot: string | null = null;

/** Contact address — matches the live address used in the Privacy policy. */
export const CONTACT_EMAIL = "admin@evans-software-solutions.com";

export const TEAMS_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Persistence for Teams",
)}`;

export const SUPPORT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Persistence support",
)}`;

export const COMPANY = "Evans Software Solutions Ltd";
export const COMPANY_URL = "https://evans-software-solutions.com";
