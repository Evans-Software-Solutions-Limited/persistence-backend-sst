import { fireEvent, render, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "@/pages/Home";
import { StoreOfferCta } from "../StoreOfferCta";
import { CampaignContext } from "../campaign";
import * as storeClick from "@/lib/storeClick";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const IOS_OFFER = "https://apps.apple.com/redeem?ctx=offercodes&id=1&code=X";
const ANDROID_OFFER = "https://play.google.com/redeem?code=X";

function useAgent(ua: string) {
  vi.stubGlobal("navigator", { ...navigator, userAgent: ua });
}

/** Renders the CTA under a campaign route, without going through Home. */
function renderCta(
  campaign: string | undefined,
  props: Partial<React.ComponentProps<typeof StoreOfferCta>> = {},
) {
  return render(
    <CampaignContext.Provider value={campaign}>
      <StoreOfferCta variant="hero" {...props} />
    </CampaignContext.Provider>,
  );
}

const offerLink = () => screen.queryByRole("link", { name: /founders' rate/i });

describe("StoreOfferCta", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("the launch switch — the redemption URL for this stage", () => {
    it("renders nothing when no URL is configured", () => {
      useAgent(IPHONE);
      renderCta("meta");
      expect(offerLink()).toBeNull();
    });

    it("renders the redemption link once the iOS URL is set", () => {
      vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
      useAgent(IPHONE);
      renderCta("meta");
      expect(offerLink()?.getAttribute("href")).toBe(IOS_OFFER);
    });

    it("renders nothing to an Android visitor while only iOS is configured", () => {
      vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
      useAgent(ANDROID);
      renderCta("meta");
      expect(offerLink()).toBeNull();
    });

    it("renders the Play URL to an Android visitor when that one is set", () => {
      vi.stubEnv("VITE_STORE_OFFER_ANDROID_URL", ANDROID_OFFER);
      useAgent(ANDROID);
      renderCta("meta");
      expect(offerLink()?.getAttribute("href")).toBe(ANDROID_OFFER);
    });

    it("treats a blank environment value as unset", () => {
      vi.stubEnv("VITE_STORE_OFFER_IOS_URL", "   ");
      useAgent(IPHONE);
      renderCta("meta");
      expect(offerLink()).toBeNull();
    });
  });

  describe("who sees it", () => {
    beforeEach(() => vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER));

    it("renders nothing on a desktop — a redemption URL is a dead end there", () => {
      useAgent(DESKTOP);
      renderCta("meta");
      expect(offerLink()).toBeNull();
    });

    it("renders nothing outside a campaign route", () => {
      useAgent(IPHONE);
      renderCta(undefined);
      expect(offerLink()).toBeNull();
    });

    it("renders nothing on a print campaign that predates the offer", () => {
      // Printed artwork is fixed for the life of the run; a slug on a leaflet
      // must not silently become an offer route.
      useAgent(IPHONE);
      renderCta("flyer");
      expect(offerLink()).toBeNull();
    });

    it("renders regardless of campaign when the gate is explicitly disabled", () => {
      // The shape a page that IS the offer's destination uses, however the
      // visitor arrived.
      useAgent(IPHONE);
      renderCta(undefined, { campaigns: null });
      expect(offerLink()).not.toBeNull();
    });
  });

  describe("what it says", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
      useAgent(IPHONE);
    });

    it("states the renewal behaviour and the eligibility", () => {
      renderCta("meta");
      expect(
        screen.getByText(
          /New subscribers only\. Renews at the standard price unless cancelled\./,
        ),
      ).toBeDefined();
    });

    it("names no price — the charged amount is set in App Store Connect", () => {
      const { container } = renderCta("meta");
      expect(container.textContent).not.toMatch(/[£$€]\s*\d/);
    });
  });

  describe("attribution", () => {
    it("reports the redemption as a store click carrying the campaign", () => {
      vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
      useAgent(IPHONE);
      const spy = vi
        .spyOn(storeClick, "reportStoreClick")
        .mockReturnValue("evt");
      renderCta("meta");
      fireEvent.click(offerLink()!);
      expect(spy).toHaveBeenCalledWith("ios", "meta");
    });
  });
});

describe("StoreOfferCta on the marketing Home", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("appears on /meta for an iOS visitor once the URL is set", () => {
    vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
    useAgent(IPHONE);
    renderPage(<Home />, { route: "/meta" });
    // Both mounts: the hero and the store section.
    expect(
      screen.getAllByRole("link", { name: /founders' rate/i }).length,
    ).toBe(2);
  });

  it("stays off the organic homepage, which keeps the plain store CTA", () => {
    vi.stubEnv("VITE_STORE_OFFER_IOS_URL", IOS_OFFER);
    useAgent(IPHONE);
    renderPage(<Home />, { route: "/" });
    expect(screen.queryByRole("link", { name: /founders' rate/i })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: /App Store/i }).length,
    ).toBeGreaterThan(0);
  });
});
