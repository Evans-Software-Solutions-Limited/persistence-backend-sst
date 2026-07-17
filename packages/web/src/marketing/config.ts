/**
 * Marketing-site config in one place.
 *
 * App Store: the iOS app is not live yet, so every "get the app" CTA renders
 * as a non-linking "Coming to the App Store" state (see `appStore.available`).
 * When the app is live, set `available: true` and fill in `url` (and `appId`)
 * — every CTA reads from here, so it's a one-place change. The `appId` also
 * unlocks a live rating badge via Apple's public iTunes Lookup API
 * (https://itunes.apple.com/lookup?id=<appId> → averageUserRating), which can
 * then replace the static proof chips in the hero.
 */
export const appStore = {
  available: false as boolean,
  url: null as string | null,
  appId: null as string | null,
};

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
