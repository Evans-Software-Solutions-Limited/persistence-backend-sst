import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "@/pages/Home";
import App from "@/App";
import {
  APPLE_PROVIDER_TOKEN,
  CAMPAIGNS,
  appStore,
  playStore,
} from "../config";
import { CAMPAIGN_LANDING_SLUGS, campaignFromPath } from "../campaign";
import { buildRedirectTable } from "../edgeRedirect";

/**
 * The gap this file exists to close.
 *
 * `config.test.ts` proves `appStoreUrl(slug)` builds the right `pt`/`ct`/`mt`
 * triple, and has done since the function was written. It passed the whole time
 * production was serving four completely undecorated App Store links on /uon,
 * because nothing ever called the function WITH a slug. Testing the function is
 * not testing the wiring.
 *
 * So these tests assert on rendered `href`s, reached through the real route →
 * layout → CTA path, and they assert it of EVERY App Store link on the page —
 * not the hero alone. The original defect was uniform, but the failure mode
 * worth guarding is the partial one: a new CTA added later that quietly skips
 * attribution while the hero still looks right.
 */
const appStoreLinks = () =>
  screen
    .getAllByRole("link")
    .filter((el) =>
      (el.getAttribute("href") ?? "").startsWith("https://apps.apple.com/"),
    );

const playStoreLinks = () =>
  screen
    .getAllByRole("link")
    .filter((el) =>
      (el.getAttribute("href") ?? "").startsWith(
        "https://play.google.com/store/apps/",
      ),
    );

/**
 * Derived from the `/g/:slug` edge redirect's table rather than listed here, so
 * the set of slugs a printed QR can resolve to and the set of slugs with a
 * working, attributing landing route are the same set by construction. Adding a
 * CAMPAIGNS entry without a Route now fails a test instead of shipping a blank
 * page on artwork that cannot be reprinted.
 */
const LANDING_SLUGS = Object.keys(buildRedirectTable().slugs);

describe("campaign attribution is wired to the landing routes", () => {
  it.each(LANDING_SLUGS)(
    "every App Store link on /%s carries that campaign's ct, pt and mt",
    (slug) => {
      renderPage(<Home />, { route: `/${slug}` });
      const links = appStoreLinks();

      // Two direct store call sites today: Home hero and download section.
      // AppBanner and MarketingNav now land on the shared download section so
      // visitors can choose their platform.
      expect(links.length).toBeGreaterThanOrEqual(2);

      for (const link of links) {
        const params = new URL(link.getAttribute("href")!).searchParams;
        expect(params.get("ct")).toBe(CAMPAIGNS[slug].ct);
        expect(params.get("pt")).toBe(APPLE_PROVIDER_TOKEN);
        expect(params.get("mt")).toBe("8");
      }

      const playLinks = playStoreLinks();
      expect(playLinks.length).toBeGreaterThanOrEqual(2);
      for (const link of playLinks) {
        const referrer = new URL(link.getAttribute("href")!).searchParams.get(
          "referrer",
        );
        expect(new URLSearchParams(referrer ?? "").get("utm_source")).toBe(
          CAMPAIGNS[slug].utm_source,
        );
        expect(new URLSearchParams(referrer ?? "").get("utm_campaign")).toBe(
          CAMPAIGNS[slug].utm_campaign,
        );
      }

      expect(screen.getByRole("link", { name: "Get" }).getAttribute("href")).toBe(
        `/${slug}#download`,
      );
      expect(
        screen.getByRole("link", { name: "Get the app" }).getAttribute("href"),
      ).toBe(`/${slug}#download`);
    },
  );

  it("leaves organic traffic on / undecorated", () => {
    renderPage(<Home />, { route: "/" });
    const links = appStoreLinks();
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(appStore.url);
    }
    for (const link of playStoreLinks()) {
      expect(link.getAttribute("href")).toBe(playStore.url);
    }
  });

  it("attributes an unrecognised /qr/:slug to the default campaign", () => {
    renderPage(<Home />, { route: "/qr/something-not-in-config" });
    for (const link of appStoreLinks()) {
      const params = new URL(link.getAttribute("href")!).searchParams;
      expect(params.get("ct")).toBe(CAMPAIGNS.default.ct);
    }
  });

  it.each(LANDING_SLUGS)(
    "serves /%s through the real route tree with its attribution intact",
    (slug) => {
      // Renders <App /> — the whole <Routes> tree — rather than <Home /> alone,
      // so this exercises the route match and MarketingLayout's campaign
      // resolution together, the way a visitor does.
      //
      // This used to assert only that the page was not blank, which was a valid
      // proof that a <Route> existed right up until App.tsx gained a catch-all:
      // after that, ANY path renders Home and the assertion could no longer
      // fail. Asserting the DECORATION instead keeps a real failure mode in
      // reach — a slug that resolves to an undecorated homepage earns nothing
      // from a printed QR, and unlike a blank page it looks fine.
      renderPage(<App />, { route: `/${slug}` });
      const links = appStoreLinks();
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        const params = new URL(link.getAttribute("href")!).searchParams;
        expect(params.get("ct")).toBe(CAMPAIGNS[slug].ct);
      }
    },
  );

  it("keeps campaign.ts and edgeRedirect.ts agreed on which slugs are real channels", () => {
    // Narrow on purpose, and titled for what it actually covers. Both lists
    // start from Object.keys(CAMPAIGNS); the ONLY divergence it can detect is
    // the two exclusion rules drifting apart — campaign.ts drops the `/qr`
    // fallback bucket from the ROUTES, edgeRedirect.ts drops RESERVED_SLUGS
    // from the /g/ TABLE, and those lists are no longer identical.
    //
    // It does NOT verify App.tsx declares any route; nothing does, and nothing
    // can — see the note there. Route drift is prevented structurally now
    // rather than tested for.
    expect([...CAMPAIGN_LANDING_SLUGS].sort()).toEqual(
      [...LANDING_SLUGS].sort(),
    );
  });

  it("renders the homepage, undecorated, for a path matching no route", () => {
    // The catch-all. Undecorated is the point: an unknown path belongs to no
    // campaign, so attributing it to one would credit a channel that did not
    // drive the visit.
    renderPage(<App />, { route: "/not-a-real-path" });
    expect(screen.getByText("Track everything.")).toBeDefined();
    for (const link of appStoreLinks()) {
      expect(link.getAttribute("href")).toBe(appStore.url);
    }
  });

  it("keeps a campaign's ct if a /g/<slug> scan ever falls through to the SPA", () => {
    // CloudFront answers /g/* at the edge, so this path should never render.
    // If the behaviour is missing or undeployed the catch-all now returns a
    // plausible 200 instead of a blank page, so the campaign must survive it —
    // printed artwork cannot be reprinted. See campaignFromPath.
    renderPage(<App />, { route: "/g/flyer" });
    for (const link of appStoreLinks()) {
      const params = new URL(link.getAttribute("href")!).searchParams;
      expect(params.get("ct")).toBe(CAMPAIGNS.flyer.ct);
    }
  });
});

describe("campaignFromPath", () => {
  it.each(LANDING_SLUGS)("maps /%s to its own campaign", (slug) => {
    expect(campaignFromPath(`/${slug}`)).toBe(slug);
  });

  it("maps /qr/:slug to the slug when it has an entry of its own", () => {
    expect(campaignFromPath("/qr/flyer")).toBe("flyer");
  });

  it("maps an unknown /qr/:slug to the default entry", () => {
    expect(campaignFromPath("/qr/conference-2027")).toBe("default");
  });

  it.each(["/", "/pricing", "/support", "/privacy"])(
    "returns undefined for the non-campaign route %s",
    (path) => {
      expect(campaignFromPath(path)).toBeUndefined();
    },
  );

  it("does not treat inherited Object keys as campaigns", () => {
    expect(campaignFromPath("/constructor")).toBeUndefined();
    expect(campaignFromPath("/toString")).toBeUndefined();
  });
});
