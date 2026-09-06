import {
  APPLE_PROVIDER_TOKEN,
  CAMPAIGNS,
  appStore,
  playStore,
} from "../config";
import {
  EDGE_REDIRECT_PREFIX,
  buildRedirectTable,
  resolveRedirect,
  slugFromPath,
  type RedirectTable,
} from "../edgeRedirect";
import {
  EDGE_FUNCTION_MAX_BYTES,
  assertWithinFunctionSizeLimit,
  buildEdgeFunctionSource,
} from "../edgeRedirectSource";

/**
 * `/g/<slug>` is the URL a printed QR code encodes. It is fixed for the life of
 * the print run, so every branch below is a thing that cannot be fixed after
 * the leaflets ship.
 *
 * The lesson this file inherits from the bug before it: `appStoreUrl()` had
 * eleven green tests while production served four undecorated links, because
 * nothing tested that anything CALLED it. So these tests assert on the resolved
 * `location`, and the last block asserts it of the code that actually runs at
 * the edge — the generated CloudFront function source, executed.
 */

// Real user-agent strings, captured rather than invented.
const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  // Both of CUBOT's model-naming styles. The space-separated ones are the
  // dangerous shape: a plain `bot\b` boundary matches them, so a real handset
  // would be classified as a crawler.
  androidCubot:
    "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  androidCubotSpaced:
    "Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
  androidCubotKingKong:
    "Mozilla/5.0 (Linux; Android 12; CUBOT KING KONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  // `CUBOT` as the whole model string — `bot)` and `bot;`, the two delimiters a
  // bot token would otherwise be recognised by.
  androidCubotBare:
    "Mozilla/5.0 (Linux; Android 10; CUBOT) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  androidCubotWebView:
    "Mozilla/5.0 (Linux; Android 13; CUBOT; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
  // In-app browsers of apps whose names collide with crawler tokens.
  pinterestApp:
    "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [Pinterest/Android]",
  yandexSearchApp:
    "Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) YandexSearch/23.10.1 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  googlebotDesktop:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotAndroid:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.175 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  facebookUnfurl:
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  whatsapp: "WhatsApp/2.23.20.0 A",
  // Crawlers the narrowed pattern still has to catch — via `bot/`, `bot.html`,
  // or an explicit name. Pinterest's is the interesting one: bare `pinterest` is
  // excluded (it is also the in-app browser), so it is caught by `bot.html`.
  bingbot:
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  applebotIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  slackbot: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discordbot:
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  twitterbot: "Twitterbot/1.0",
  storebot: "Mozilla/5.0 (compatible; Storebot-Google/1.0)",
  pinterestCrawler: "Pinterest/0.2 (+http://www.pinterest.com/bot.html)",
  empty: "",
  junk: "%%%¬\\x00 not-a-user-agent",
} as const;

/** Every slug reachable as `/g/<slug>` — derived, never retyped. */
const REACHABLE_SLUGS = Object.keys(buildRedirectTable().slugs);

/** A table with the Play listing live, without mutating shared config. */
function playLiveTable(): RedirectTable {
  const before = { available: playStore.available, url: playStore.url };
  playStore.available = true;
  playStore.url =
    "https://play.google.com/store/apps/details?id=com.evanssoftwaresolutions.persistence";
  try {
    return buildRedirectTable();
  } finally {
    playStore.available = before.available;
    playStore.url = before.url;
  }
}

describe("the redirect table", () => {
  it("covers every CAMPAIGNS entry except the /qr catch-all", () => {
    // `default` is the attribution bucket for an unrecognised /qr/:slug, not a
    // channel — it has no landing route, so it must not be reachable as /g/.
    expect(REACHABLE_SLUGS.sort()).toEqual(
      Object.keys(CAMPAIGNS)
        .filter((slug) => slug !== "default")
        .sort(),
    );
  });

  it("gives every reachable slug a landing path matching its slug", () => {
    for (const slug of REACHABLE_SLUGS) {
      expect(buildRedirectTable().slugs[slug].landing).toBe(`/${slug}`);
    }
  });

  it.each([
    // Both twins lower-case the URI before lookup, so this can never match.
    ["UoN26", "upper case"],
    // Both split the path before decoding, so `/g/a%2Fb` never resolves.
    ["a/b", "a slash"],
    // Reachable, but the slug becomes a Location header value.
    ["open day", "a space"],
    ["café", "a non-ASCII character"],
  ])(
    "refuses the slug %o (%s) at synth rather than shipping a dead QR",
    (slug) => {
      // Every one of these fails SILENTLY at runtime, and the parity tests are
      // blind to all of them because BOTH twins would agree on `/`.
      CAMPAIGNS[slug] = { ct: slug };
      try {
        expect(() => buildRedirectTable()).toThrow(/must match/);
      } finally {
        delete CAMPAIGNS[slug];
      }
      expect(() => buildRedirectTable()).not.toThrow();
    },
  );

  it.each(["g", "qr"])(
    "THROWS on a campaign named %s rather than silently dropping it",
    (slug) => {
      // These are path prefixes campaignFromPath intercepts, so such a campaign
      // would be attributed ct=qr instead of its own token — and "g" collides
      // with EDGE_REDIRECT_PREFIX, so a /g/g scan would hop to /g and resolve
      // to /, campaign lost, on artwork that cannot be reprinted.
      //
      // Throwing is the whole point: a shared skip-list merely dropped the slug
      // from the table, which produced that dead QR via the very validator
      // meant to prevent it. So this asserts the THROW, not the absence.
      CAMPAIGNS[slug] = { ct: slug };
      try {
        expect(() => buildRedirectTable()).toThrow(/reserved/i);
      } finally {
        delete CAMPAIGNS[slug];
      }
    },
  );

  it.each(["uon-2027", "flyer2", "gym-open-day"])(
    "accepts the well-formed slug %o",
    (slug) => {
      CAMPAIGNS[slug] = { ct: slug };
      try {
        expect(() => buildRedirectTable()).not.toThrow();
        expect(buildRedirectTable().slugs[slug].landing).toBe(`/${slug}`);
      } finally {
        delete CAMPAIGNS[slug];
      }
    },
  );

  it("keeps the path prefix lower-case, for the same reason", () => {
    expect(EDGE_REDIRECT_PREFIX).toBe(EDGE_REDIRECT_PREFIX.toLowerCase());
  });

  it("has no landing path carrying a query string of its own", () => {
    // The invariant that lets the query-string forwarder always join with `?`
    // instead of branching on `?` vs `&` — a branch the edge twin would have to
    // keep in step for no reachable case.
    const table = buildRedirectTable();
    for (const landing of [
      ...Object.values(table.slugs).map((t) => t.landing),
      table.fallbackLanding,
    ]) {
      expect(landing).not.toContain("?");
    }
  });
});

describe("slugFromPath", () => {
  it.each([
    ["/g/flyer", "flyer"],
    ["/g/flyer/", "flyer"],
    ["/g/FLYER", "flyer"],
    ["/G/flyer", "flyer"],
    ["/G/FLYER", "flyer"],
    ["/g/flyer/extra", "flyer"],
    ["/g/%66lyer", "flyer"],
    // %46 decodes to an upper-case F — only reachable if the slug is
    // lower-cased AFTER decoding as well as before.
    ["/g/%46lyer", "flyer"],
    ["/G/%46LYER", "flyer"],
    ["/g", ""],
    ["/g/", ""],
    ["//g//", ""],
    ["/flyer", ""],
  ])("maps %s to %o", (pathname, expected) => {
    expect(slugFromPath(pathname)).toBe(expected);
  });

  it("survives malformed percent-encoding instead of throwing", () => {
    // decodeURIComponent("%E0%A4%A") throws URIError; the edge must still answer.
    expect(slugFromPath("/g/%E0%A4%A")).toBe("%e0%a4%a");
  });
});

describe("iOS scans reach the App Store with this campaign's attribution", () => {
  const iosAgents = [UA.iphone, UA.ipad, UA.ipod, UA.iphoneChrome];

  it.each(REACHABLE_SLUGS.flatMap((slug) => iosAgents.map((ua) => [slug, ua])))(
    "/g/%s on an iOS user-agent 302s to the store with ct, pt and mt",
    (slug, ua) => {
      const { status, location } = resolveRedirect(`/g/${slug}`, ua as string);
      expect(status).toBe(302);

      const url = new URL(location);
      expect(url.origin).toBe("https://apps.apple.com");
      // Storefront-agnostic: a /gb/ path would send all 175 territories to the
      // UK store. Guarded in config.test.ts too — restated here because this is
      // the URL a printed QR resolves to.
      expect(url.pathname).toBe(`/app/apple-store/id${appStore.appId}`);
      expect(url.searchParams.get("ct")).toBe(CAMPAIGNS[slug as string].ct);
      expect(url.searchParams.get("pt")).toBe(APPLE_PROVIDER_TOKEN);
      expect(url.searchParams.get("mt")).toBe("8");
    },
  );

  it("does not point at a storefront-specific path", () => {
    const { location } = resolveRedirect("/g/flyer", UA.iphone);
    expect(location).not.toContain("/gb/");
    expect(new URL(location).pathname).toMatch(/^\/app\/apple-store\/id\d+$/);
  });
});

describe("everyone else gets the campaign landing page", () => {
  it.each([
    ["desktop Chrome", UA.chromeDesktop],
    ["macOS Safari", UA.macSafari],
    ["an empty user-agent", UA.empty],
    ["a malformed user-agent", UA.junk],
  ])("%s scanning /g/flyer lands on /flyer", (_label, ua) => {
    expect(resolveRedirect("/g/flyer", ua)).toEqual({
      status: 302,
      location: "/flyer",
    });
  });

  it.each(REACHABLE_SLUGS)(
    "/g/%s sends a desktop viewer to that slug's own landing route",
    (slug) => {
      // NOT `/`. `/<slug>` decorates every store CTA with this campaign's ct and
      // fires the Meta pixel; `/` does neither, so falling back to the homepage
      // would silently drop attribution for every desktop scan.
      expect(resolveRedirect(`/g/${slug}`, UA.chromeDesktop).location).toBe(
        `/${slug}`,
      );
    },
  );

  it.each([
    ["desktop Googlebot", UA.googlebotDesktop],
    ["Googlebot's iPhone crawler", UA.googlebotIphone],
    ["Googlebot's Android crawler", UA.googlebotAndroid],
    ["a Facebook link unfurl", UA.facebookUnfurl],
    ["a WhatsApp link preview", UA.whatsapp],
    ["bingbot", UA.bingbot],
    ["Applebot's iPhone crawler", UA.applebotIphone],
    ["Slackbot", UA.slackbot],
    ["Discordbot", UA.discordbot],
    ["Twitterbot", UA.twitterbot],
    ["Storebot-Google", UA.storebot],
    ["Pinterest's crawler", UA.pinterestCrawler],
  ])("%s is never sent to the App Store", (_label, ua) => {
    // Googlebot-smartphone advertises an iPhone UA. Without the bot check an
    // apps.apple.com URL would end up in Google's index for /g/flyer, and a
    // WhatsApp unfurl would render no OG card.
    expect(resolveRedirect("/g/flyer", ua).location).toBe("/flyer");
  });

  it.each([
    ["/G/flyer", "/flyer"],
    ["/G/FLYER", "/flyer"],
    ["/G", "/"],
  ])(
    "resolves the upper-case prefix %s, which CloudFront routes separately",
    (pathname, expected) => {
      // CloudFront path patterns are case-sensitive, so `/G/*` is bound to its
      // own behaviours (infra/web.ts). If this returned `/` instead of `/flyer`
      // the redirect would work but silently drop the campaign.
      expect(resolveRedirect(pathname, UA.chromeDesktop).location).toBe(
        expected,
      );
    },
  );
});

/**
 * Real handsets whose user-agent contains a crawler token as a substring. These
 * are only distinguishable from a bot once Play is live — until then both
 * branches land on the same page — so they are asserted against a Play-live
 * table, where a genuine Android device reaches Play and a bot does not.
 */
describe("brand names that look like crawler tokens are not crawlers", () => {
  it.each([
    ["CUBOT_X30", UA.androidCubot],
    ["CUBOT NOTE 20", UA.androidCubotSpaced],
    ["CUBOT KING KONG 9", UA.androidCubotKingKong],
    ["a bare CUBOT model string", UA.androidCubotBare],
    ["a CUBOT WebView", UA.androidCubotWebView],
    ["the Pinterest in-app browser", UA.pinterestApp],
    ["the Yandex Search app", UA.yandexSearchApp],
  ])("%s is treated as a real Android device", (_label, ua) => {
    const table = playLiveTable();
    expect(resolveRedirect("/g/flyer", ua, { table }).location).toContain(
      "play.google.com",
    );
  });

  it.each([
    ["desktop Googlebot", UA.googlebotDesktop],
    ["Googlebot's Android crawler", UA.googlebotAndroid],
    ["a WhatsApp link preview", UA.whatsapp],
  ])("%s is still held back from the store once Play is live", (_label, ua) => {
    const table = playLiveTable();
    expect(resolveRedirect("/g/flyer", ua, { table }).location).toBe("/flyer");
  });
});

describe("the query string survives the hop to a landing page", () => {
  it("carries Meta's click id onto the landing page", () => {
    // Without this the pixel on /ig fires a PageView with no fbclid to seed
    // `_fbc` from, so every ad-driven scan is an unmatched event.
    expect(
      resolveRedirect("/g/ig", UA.chromeDesktop, {
        search: "?fbclid=IwAR_test123",
      }).location,
    ).toBe("/ig?fbclid=IwAR_test123");
  });

  it("accepts a query string with or without the leading ?", () => {
    expect(
      resolveRedirect("/g/flyer", UA.chromeDesktop, { search: "a=1&b=2" })
        .location,
    ).toBe("/flyer?a=1&b=2");
  });

  it("carries it onto the fallback landing page too", () => {
    expect(
      resolveRedirect("/g/unknown", UA.android, { search: "?fbclid=x" })
        .location,
    ).toBe("/?fbclid=x");
  });

  it("leaves the App Store URL exactly as generated", () => {
    // Apple reads only pt/ct/mt; appending fbclid would alter a URL that is
    // byte-identical to one App Store Connect generated itself.
    const { location } = resolveRedirect("/g/flyer", UA.iphone, {
      search: "?fbclid=IwAR_test123",
    });
    expect(location).not.toContain("fbclid");
    expect(location).toBe(buildRedirectTable().slugs.flyer.ios);
  });

  it("is a no-op for an empty or bare query string", () => {
    expect(
      resolveRedirect("/g/flyer", UA.chromeDesktop, { search: "" }).location,
    ).toBe("/flyer");
    expect(
      resolveRedirect("/g/flyer", UA.chromeDesktop, { search: "?" }).location,
    ).toBe("/flyer");
  });
});

describe("nothing under /g can 404", () => {
  it.each([
    "/g",
    "/g/",
    "/g/unknown-slug",
    "/g/conference-2027",
    "/g/default",
    "/g/constructor",
    "/g/toString",
    "/g/__proto__",
    "/g/favicon.ico",
    "/g/flyer%00",
  ])("%s 302s to / rather than reaching the origin", (pathname) => {
    for (const ua of [UA.iphone, UA.android, UA.chromeDesktop, UA.empty]) {
      expect(resolveRedirect(pathname, ua)).toEqual({
        status: 302,
        location: "/",
      });
    }
  });

  it("sends an unknown slug to / even on iOS", () => {
    // An unknown slug is a QR we never issued: there is no campaign to
    // attribute, so there is no reason to push an unattributed install. `/`
    // still carries a live App Store CTA.
    expect(resolveRedirect("/g/typo", UA.iphone).location).toBe("/");
  });
});

describe("Android is gated on the Play listing being live", () => {
  it("falls back to campaign landings if the Play listing is pulled", () => {
    const before = { available: playStore.available, url: playStore.url };
    playStore.available = false;
    const table = buildRedirectTable();
    playStore.available = before.available;
    playStore.url = before.url;
    for (const slug of REACHABLE_SLUGS) {
      const { location } = resolveRedirect(`/g/${slug}`, UA.android, { table });
      expect(location).toBe(`/${slug}`);
      expect(location).not.toContain("play.google.com");
    }
  });

  it("routes Android to the Play listing once it flips, from config alone", () => {
    // What this asserts is the GATE: no artwork reprint, no code change — the
    // flag and the URL in config are the whole switch.
    const table = playLiveTable();
    const { status, location } = resolveRedirect("/g/flyer", UA.android, {
      table,
    });
    expect(status).toBe(302);
    expect(new URL(location).origin).toBe("https://play.google.com");
    const referrer = new URLSearchParams(
      new URL(location).searchParams.get("referrer")!,
    );
    expect(referrer.get("utm_source")).toBe(CAMPAIGNS.flyer.utm_source);
    expect(referrer.get("utm_campaign")).toBe(CAMPAIGNS.flyer.utm_campaign);
  });

  it("still sends iOS to the App Store once Play is live", () => {
    const table = playLiveTable();
    expect(
      resolveRedirect("/g/flyer", UA.iphone, { table }).location,
    ).toContain("apps.apple.com");
  });

  it("degrades iOS to the landing page if the App Store listing is pulled", () => {
    // Symmetry with the Android gate: both stores are flag-driven, so a
    // withdrawn listing turns every printed QR into a landing-page scan rather
    // than a dead store link.
    const before = appStore.available;
    appStore.available = false;
    try {
      const table = buildRedirectTable();
      expect(table.slugs.flyer.ios).toBeNull();
      expect(resolveRedirect("/g/flyer", UA.iphone, { table }).location).toBe(
        "/flyer",
      );
    } finally {
      appStore.available = before;
    }
  });

  it("restores playStore config after the flip", () => {
    playLiveTable();
    expect(playStore.available).toBe(true);
    expect(playStore.url).toBe(
      "https://play.google.com/store/apps/details?id=com.bradleyevans96.persistence",
    );
  });
});

/**
 * The block that matters most: `resolveRedirect` is not what runs in
 * production. The CloudFront Function generated by `buildEdgeFunctionSource` is.
 * These tests execute that generated source and hold it to the same contract.
 */
describe("the generated CloudFront Function", () => {
  type EdgeResponse = {
    statusCode: number;
    statusDescription: string;
    headers: Record<string, { value: string }>;
  };

  const runEdge = (() => {
    const source = buildEdgeFunctionSource();
    const factory = new Function(
      "event",
      `${source}\nreturn handler(event);`,
    ) as (event: unknown) => EdgeResponse;
    return (
      uri: string,
      userAgent: string | null,
      // CloudFront hands the query string over as a parsed object, not a string.
      querystring: Record<string, { value: string }> = {},
    ): EdgeResponse =>
      factory({
        request: {
          uri,
          querystring,
          headers:
            userAgent === null ? {} : { "user-agent": { value: userAgent } },
        },
      });
  })();

  it("fits inside CloudFront's source-size limit", () => {
    expect(
      new TextEncoder().encode(buildEdgeFunctionSource()).length,
    ).toBeLessThan(EDGE_FUNCTION_MAX_BYTES);
  });

  it("fails the deploy loudly rather than silently, if it ever outgrows it", () => {
    // `infra/` has no typecheck and no tests, so an oversized body would
    // otherwise surface as an opaque CloudFront deploy error.
    expect(() =>
      assertWithinFunctionSizeLimit("x".repeat(EDGE_FUNCTION_MAX_BYTES + 1)),
    ).toThrow(/over CloudFront's/);
    expect(() =>
      assertWithinFunctionSizeLimit("x".repeat(EDGE_FUNCTION_MAX_BYTES)),
    ).not.toThrow();
  });

  it("returns a no-store 302 with a location header", () => {
    const res = runEdge("/g/flyer", UA.iphone);
    expect(res.statusCode).toBe(302);
    expect(res.statusDescription).toBe("Found");
    expect(res.headers["cache-control"].value).toBe("no-store");
    expect(res.headers.location.value).toContain("apps.apple.com");
  });

  it("answers even when the request carries no user-agent header at all", () => {
    expect(runEdge("/g/flyer", null).headers.location.value).toBe("/flyer");
  });

  it("embeds the campaign tokens rather than a placeholder", () => {
    const source = buildEdgeFunctionSource();
    for (const slug of REACHABLE_SLUGS) {
      expect(source).toContain(`ct=${CAMPAIGNS[slug].ct}`);
    }
    expect(source).toContain(APPLE_PROVIDER_TOKEN);
  });

  it("embeds the live Play listing and encoded install referrers", () => {
    const source = buildEdgeFunctionSource();
    expect(source).toContain("play.google.com");
    expect(source).toContain(
      "referrer=utm_source%3Dflyer%26utm_campaign%3Dprint",
    );
  });

  /**
   * Parity. The edge body restates `resolveRedirect`'s branches in ES5 because
   * the browser CSP forbids `unsafe-eval`, so the two cannot share one
   * implementation. This is what stops them drifting.
   */
  const PATHS = [
    ...REACHABLE_SLUGS.map((slug) => `/g/${slug}`),
    "/g",
    "/g/",
    "/g/FLYER",
    "/G/flyer",
    "/G",
    "/g/flyer/",
    "/g/%66lyer",
    "/g/unknown-slug",
    "/g/default",
    "/g/constructor",
    "/g/__proto__",
    "/g/%E0%A4%A",
  ];

  it.each(
    PATHS.flatMap((uri) =>
      Object.entries(UA).map(([label, ua]) => [uri, label, ua] as const),
    ),
  )("agrees with resolveRedirect for %s on %s", (uri, _label, ua) => {
    const res = runEdge(uri, ua);
    const expected = resolveRedirect(uri, ua);
    expect(res.statusCode).toBe(expected.status);
    expect(res.headers.location.value).toBe(expected.location);
  });

  it.each([
    ["/g/ig", { fbclid: "IwAR_test123" }],
    ["/g/flyer", { fbclid: "IwAR_test123" }], // iOS branch: must NOT gain it
    ["/g/unknown", { fbclid: "x", utm_content: "a" }],
    ["/g/flyer", {}],
    // Values that are already percent-encoded on the wire. CloudFront hands
    // these to the function verbatim, so the oracle must too — building the
    // expected `search` with URLSearchParams would re-encode the `%` and make
    // the two disagree over a difference that does not exist in production.
    ["/g/flyer", { utm_content: "Ad%20Set%20A" }],
    ["/g/social", { fbclid: "abc+def%2Fghi" }],
  ])(
    "agrees with resolveRedirect on the query string for %s",
    (uri, params: Record<string, string>) => {
      const querystring = Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, { value: v }]),
      );
      const search = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      for (const ua of [UA.iphone, UA.android, UA.chromeDesktop]) {
        expect(runEdge(uri, ua, querystring).headers.location.value).toBe(
          resolveRedirect(uri, ua, { search }).location,
        );
      }
    },
  );
});
