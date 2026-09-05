import { currentPlatform, platformFromUserAgent } from "../platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const GOOGLEBOT_SMARTPHONE =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const FACEBOOK_UNFURL =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

describe("platformFromUserAgent", () => {
  it.each([
    ["an iPhone", IPHONE],
    ["an iPad", IPAD],
  ])("classifies %s as ios", (_label, ua) => {
    expect(platformFromUserAgent(ua)).toBe("ios");
  });

  it("classifies an Android handset as android", () => {
    expect(platformFromUserAgent(ANDROID)).toBe("android");
  });

  it.each([
    ["macOS", MAC],
    ["Windows", WINDOWS],
  ])("classifies %s as other, not a redeemable platform", (_label, ua) => {
    // An Apple Silicon Mac can run iOS apps, but a redemption URL on a desktop
    // is a dead end — the same call the /g/:slug edge function makes.
    expect(platformFromUserAgent(ua)).toBe("other");
  });

  it("classifies Googlebot's smartphone crawler as other, not android", () => {
    // It advertises a real Android handset string. Without the bot check first
    // an offer redemption link would end up in Google's index.
    expect(platformFromUserAgent(GOOGLEBOT_SMARTPHONE)).toBe("other");
  });

  it("classifies a Facebook link unfurl as other", () => {
    expect(platformFromUserAgent(FACEBOOK_UNFURL)).toBe("other");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
  ])("classifies a %s user-agent as other", (_label, ua) => {
    expect(platformFromUserAgent(ua)).toBe("other");
  });

  it("does not mistake a CUBOT handset for a crawler", () => {
    // `bot` is a substring of the Android brand CUBOT — the edge patterns
    // handle this and this reuses them, so the trap stays closed on both.
    expect(
      platformFromUserAgent(
        "Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20) AppleWebKit/537.36 Mobile Safari/537.36",
      ),
    ).toBe("android");
  });
});

describe("currentPlatform", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the live navigator user-agent", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: IPHONE });
    expect(currentPlatform()).toBe("ios");
  });

  it("answers other when there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(currentPlatform()).toBe("other");
  });
});
