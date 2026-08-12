import { appStore, playStore, appStoreUrl, playStoreUrl } from "../config";

describe("appStoreUrl / playStoreUrl", () => {
  afterEach(() => {
    appStore.url = null;
    appStore.available = false;
    playStore.url = null;
    playStore.available = false;
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

  it("appends Apple ct/pt params for a known campaign", () => {
    appStore.url = "https://apps.apple.com/app/id123456789";
    const url = appStoreUrl("uon");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("ct")).toBe("uon");
    expect(parsed.searchParams.get("pt")).toBe("uon_campus");
  });

  it("appends Play utm_source/utm_campaign params for a known campaign, preserving existing query params", () => {
    playStore.url = "https://play.google.com/store/apps/details?id=com.app";
    const url = playStoreUrl("flyer");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("id")).toBe("com.app");
    expect(parsed.searchParams.get("utm_source")).toBe("flyer");
    expect(parsed.searchParams.get("utm_campaign")).toBe("print");
  });

  it("falls back to the bare url for an unknown campaign slug", () => {
    appStore.url = "https://apps.apple.com/app/id123456789";
    playStore.url = "https://play.google.com/store/apps/details?id=com.app";
    expect(appStoreUrl("not-a-real-campaign")).toBe(appStore.url);
    expect(playStoreUrl("not-a-real-campaign")).toBe(playStore.url);
  });

  it("uses the default campaign entry for /qr/:slug style lookups", () => {
    appStore.url = "https://apps.apple.com/app/id123456789";
    const url = appStoreUrl("default");
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("ct")).toBe("qr");
    expect(parsed.searchParams.get("pt")).toBe("qr");
  });
});
