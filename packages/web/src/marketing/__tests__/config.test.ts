import {
  appStore,
  playStore,
  appStoreUrl,
  playStoreUrl,
  APPLE_PROVIDER_TOKEN,
} from "../config";

/**
 * Captured at import time, before any reset below mutates the module. These are
 * the values the site actually ships with — asserted in "shipped config" at the
 * bottom of this file.
 */
const SHIPPED = {
  appStore: { ...appStore },
  playStore: { ...playStore },
};

describe("appStoreUrl / playStoreUrl", () => {
  // Reset BEFORE each test, not after: the store config now ships live, so a
  // test that wants the not-yet-live behaviour has to clear it first. An
  // afterEach alone left the very first test reading the real shipped values.
  beforeEach(() => {
    appStore.url = null;
    appStore.available = false;
    playStore.url = null;
    playStore.available = false;
  });

  afterEach(() => {
    Object.assign(appStore, SHIPPED.appStore);
    Object.assign(playStore, SHIPPED.playStore);
  });

  it("returns null when the store url is not set, campaign or not", () => {
    expect(appStoreUrl()).toBeNull();
    expect(appStoreUrl("uon")).toBeNull();
    expect(playStoreUrl()).toBeNull();
    expect(playStoreUrl("flyer")).toBeNull();
  });

  it("returns the bare url when a url is set but no campaign is given", () => {
    appStore.url = "https://apps.apple.com/app/id123456789";
    playStore.url = "https://play.google.com/store/apps/details?id=com.app";

    expect(appStoreUrl()).toBe("https://apps.apple.com/app/id123456789");
    expect(playStoreUrl()).toBe(
      "https://play.google.com/store/apps/details?id=com.app",
    );
  });

  it("appends Apple ct/pt/mt params for a known campaign", () => {
    appStore.url = "https://apps.apple.com/app/apple-store/id123456789";
    const url = appStoreUrl("uon");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("ct")).toBe("uon");
    expect(parsed.searchParams.get("pt")).toBe(APPLE_PROVIDER_TOKEN);
    expect(parsed.searchParams.get("mt")).toBe("8");
  });

  it("uses the same provider token on every campaign — pt is not per-campaign", () => {
    appStore.url = "https://apps.apple.com/app/apple-store/id123456789";
    const pt = (slug: string) =>
      new URL(appStoreUrl(slug)!).searchParams.get("pt");

    expect(pt("uon")).toBe(APPLE_PROVIDER_TOKEN);
    expect(pt("flyer")).toBe(APPLE_PROVIDER_TOKEN);
    expect(pt("default")).toBe(APPLE_PROVIDER_TOKEN);
  });

  it("uses a numeric provider token", () => {
    expect(APPLE_PROVIDER_TOKEN).toMatch(/^\d+$/);
  });

  it("nests Play campaign UTMs inside the encoded install referrer", () => {
    playStore.url = "https://play.google.com/store/apps/details?id=com.app";
    const url = playStoreUrl("flyer");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("id")).toBe("com.app");
    expect(parsed.searchParams.has("utm_source")).toBe(false);
    expect(parsed.searchParams.has("utm_campaign")).toBe(false);
    const referrer = new URLSearchParams(parsed.searchParams.get("referrer")!);
    expect(referrer.get("utm_source")).toBe("flyer");
    expect(referrer.get("utm_campaign")).toBe("print");
  });

  it("falls back to the bare url for an unknown campaign slug", () => {
    appStore.url = "https://apps.apple.com/app/id123456789";
    playStore.url = "https://play.google.com/store/apps/details?id=com.app";
    expect(appStoreUrl("not-a-real-campaign")).toBe(appStore.url);
    expect(playStoreUrl("not-a-real-campaign")).toBe(playStore.url);
  });

  it("uses the default campaign entry for /qr/:slug style lookups", () => {
    appStore.url = "https://apps.apple.com/app/apple-store/id123456789";
    const url = appStoreUrl("default");
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("ct")).toBe("qr");
    expect(parsed.searchParams.get("pt")).toBe(APPLE_PROVIDER_TOKEN);
  });
});

describe("shipped config", () => {
  it("has the App Store live, so every CTA renders as a real link", () => {
    expect(SHIPPED.appStore.available).toBe(true);
    expect(SHIPPED.appStore.url).toBe(
      "https://apps.apple.com/app/apple-store/id6755091280",
    );
    expect(SHIPPED.appStore.appId).toBe("6755091280");
  });

  it("uses a storefront-agnostic App Store url", () => {
    // A /gb/ or any other country-locked path would send all 175 territories
    // to the UK store.
    expect(SHIPPED.appStore.url).not.toMatch(
      /apps\.apple\.com\/[a-z]{2}\//,
    );
  });

  it("has Google Play live with the production package listing", () => {
    expect(SHIPPED.playStore.available).toBe(true);
    expect(SHIPPED.playStore.url).toBe(
      "https://play.google.com/store/apps/details?id=com.bradleyevans96.persistence",
    );
  });
});
