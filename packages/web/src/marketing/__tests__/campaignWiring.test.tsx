import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "@/pages/Home";
import App from "@/App";
import { APPLE_PROVIDER_TOKEN, CAMPAIGNS, appStore } from "../config";
import { campaignFromPath } from "../campaign";
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

      // Four known call sites today: AppBanner, MarketingNav, Home hero,
      // Home store section. If this number changes, the loop below is what
      // matters — confirm the new CTA attributes rather than just bumping it.
      expect(links.length).toBeGreaterThanOrEqual(4);

      for (const link of links) {
        const params = new URL(link.getAttribute("href")!).searchParams;
        expect(params.get("ct")).toBe(CAMPAIGNS[slug].ct);
        expect(params.get("pt")).toBe(APPLE_PROVIDER_TOKEN);
        expect(params.get("mt")).toBe("8");
      }
    },
  );

  it("leaves organic traffic on / undecorated", () => {
    renderPage(<Home />, { route: "/" });
    const links = appStoreLinks();
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(appStore.url);
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
    "registers /%s as a real route, so the link is never a blank page",
    (slug) => {
      // A CAMPAIGNS entry without a matching <Route> is worse than no
      // attribution: nothing matches, Routes renders nothing, and the visitor
      // gets a blank page. For a printed QR that is unrecoverable.
      renderPage(<App />, { route: `/${slug}` });
      expect(screen.getByText("Track everything.")).toBeDefined();
    },
  );
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
