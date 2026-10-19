import {
  TDUID_STORAGE_KEY,
  captureTduid,
  hasAffiliateReferral,
  initTradedoubler,
  storedTduid,
  teardownTradedoubler,
  trackTradedoublerSale,
} from "../tradedoubler";
import { setConsent } from "../consent";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });
}

function sdkScripts() {
  return document.querySelectorAll<HTMLScriptElement>(
    'script[src*="svht.tradedoubler.com"]',
  );
}

function configure() {
  vi.stubEnv("VITE_TRADEDOUBLER_ORG_ID", "123456");
  vi.stubEnv("VITE_TRADEDOUBLER_PROGRAM_ID", "654321");
  vi.stubEnv("VITE_TRADEDOUBLER_SALE_EVENT_ID", "999999");
}

/** Replace the queue fn with a recorder so calls can be asserted on. */
function recordCalls(): unknown[][] {
  const calls: unknown[][] = [];
  window.tdconv = Object.assign(
    (...args: unknown[]) => calls.push(args),
    window.tdconv,
  );
  return calls;
}

describe("tradedoubler", () => {
  beforeEach(() => {
    setConsent({ advertising: false, affiliate: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.tdconv;
    delete window.TDConversionObject;
    sdkScripts().forEach((el) => el.remove());
    clearCookies();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  describe("initTradedoubler", () => {
    it("no-ops when the ids are unset", () => {
      vi.stubEnv("VITE_TRADEDOUBLER_ORG_ID", "");
      vi.stubEnv("VITE_TRADEDOUBLER_PROGRAM_ID", "");
      initTradedoubler();
      expect(window.tdconv).toBeUndefined();
      expect(sdkScripts().length).toBe(0);
    });

    it("no-ops when the ids are entirely absent from the build (not merely empty)", () => {
      for (const name of [
        "VITE_TRADEDOUBLER_ORG_ID",
        "VITE_TRADEDOUBLER_PROGRAM_ID",
        "VITE_TRADEDOUBLER_SALE_EVENT_ID",
      ]) {
        vi.stubEnv(name, undefined);
      }
      initTradedoubler();
      expect(window.tdconv).toBeUndefined();
      expect(() =>
        trackTradedoublerSale({
          transactionId: "x",
          orderValue: 1,
          voucher: "",
          currency: "GBP",
        }),
      ).not.toThrow();
    });

    it("no-ops when only one of the two tag ids is set", () => {
      vi.stubEnv("VITE_TRADEDOUBLER_ORG_ID", "123456");
      vi.stubEnv("VITE_TRADEDOUBLER_PROGRAM_ID", "");
      initTradedoubler();
      expect(window.tdconv).toBeUndefined();
    });

    it("injects the vendor loader with the ids, dr=true and a cache-buster, then queues tracking-consent", () => {
      configure();
      initTradedoubler();

      expect(window.TDConversionObject).toBe("tdconv");
      expect(window.tdconv).toBeDefined();
      expect(typeof window.tdconv!.l).toBe("number");
      const scripts = sdkScripts();
      expect(scripts.length).toBe(1);
      expect(scripts[0].async).toBe(true);
      const url = new URL(scripts[0].src);
      expect(url.origin + url.pathname).toBe(
        "https://svht.tradedoubler.com/tr_sdk.js",
      );
      expect(url.searchParams.get("org")).toBe("123456");
      expect(url.searchParams.get("prog")).toBe("654321");
      expect(url.searchParams.get("dr")).toBe("true");
      expect(Number(url.searchParams.get("and"))).toBeGreaterThanOrEqual(0);
      expect(Number(url.searchParams.get("and"))).toBeLessThan(1);
      // The consent signal is queued for the SDK to drain once it loads.
      expect(window.tdconv!.q).toEqual([["tracking-consent", true]]);
    });

    it("is idempotent — a second call injects no second script and queues nothing more", () => {
      configure();
      initTradedoubler();
      initTradedoubler();
      expect(sdkScripts().length).toBe(1);
      expect(window.tdconv!.q).toHaveLength(1);
    });

    it("no-ops without affiliate consent even when configured", () => {
      configure();
      setConsent({ advertising: true, affiliate: false });
      initTradedoubler();
      expect(window.tdconv).toBeUndefined();
      expect(sdkScripts().length).toBe(0);
    });

    it("no-ops when consent is undecided", () => {
      configure();
      window.localStorage.clear();
      initTradedoubler();
      expect(window.tdconv).toBeUndefined();
    });

    it("inserts before the first existing script tag, as the vendor snippet does", () => {
      configure();
      const anchor = document.createElement("script");
      anchor.setAttribute("data-anchor", "1");
      document.body.appendChild(anchor);
      try {
        initTradedoubler();
        const sdk = sdkScripts()[0];
        expect(sdk.nextElementSibling).toBe(anchor);
      } finally {
        anchor.remove();
      }
    });

    it("appends to <head> when the document has no script tag to insert before", () => {
      configure();
      const scripts = Array.from(document.getElementsByTagName("script"));
      const parents = scripts.map((s) => [s, s.parentNode] as const);
      scripts.forEach((s) => s.remove());
      try {
        initTradedoubler();
        expect(document.head.querySelector('script[src*="svht"]')).not.toBe(
          null,
        );
      } finally {
        sdkScripts().forEach((el) => el.remove());
        parents.forEach(([s, p]) => p?.appendChild(s));
      }
    });
  });

  describe("captureTduid / storedTduid", () => {
    it("stores the URL tduid in sessionStorage with consent", () => {
      window.history.replaceState({}, "", "/blue-light-card?tduid=abc123");
      expect(captureTduid()).toBe("abc123");
      expect(storedTduid()).toBe("abc123");
      expect(window.sessionStorage.getItem(TDUID_STORAGE_KEY)).toBe("abc123");
    });

    it("reads but does NOT store the tduid without consent (vendor rule)", () => {
      setConsent({ advertising: true, affiliate: false });
      window.history.replaceState({}, "", "/blue-light-card?tduid=abc123");
      expect(captureTduid()).toBe("abc123");
      expect(storedTduid()).toBeUndefined();
    });

    it("returns null and stores nothing when the URL carries no tduid", () => {
      window.history.replaceState({}, "", "/blue-light-card?other=1");
      expect(captureTduid()).toBeNull();
      expect(storedTduid()).toBeUndefined();
    });

    it("ignores an empty tduid", () => {
      window.history.replaceState({}, "", "/blue-light-card?tduid=%20");
      expect(captureTduid()).toBeNull();
    });

    it("survives a storage that throws", () => {
      window.history.replaceState({}, "", "/blue-light-card?tduid=abc123");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("private mode");
      });
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("private mode");
      });
      expect(() => captureTduid()).not.toThrow();
      expect(storedTduid()).toBeUndefined();
      vi.restoreAllMocks();
    });
  });

  describe("hasAffiliateReferral", () => {
    it("is false for a plain visit", () => {
      expect(hasAffiliateReferral()).toBe(false);
    });

    it("is true for a tduid on the URL, even before consent", () => {
      setConsent({ advertising: false, affiliate: false });
      window.history.replaceState({}, "", "/blue-light-card?tduid=abc123");
      expect(hasAffiliateReferral()).toBe(true);
    });

    it("is true for a tduid kept from an earlier page", () => {
      window.sessionStorage.setItem(TDUID_STORAGE_KEY, "kept");
      expect(hasAffiliateReferral()).toBe(true);
    });

    it("is true when the SDK's TRADEDOUBLER cookie exists", () => {
      document.cookie = "TRADEDOUBLER=cookie-value";
      expect(hasAffiliateReferral()).toBe(true);
    });
  });

  describe("teardownTradedoubler", () => {
    it("tells a loaded SDK consent is withdrawn, expires the cookie and drops the stored id", () => {
      configure();
      window.history.replaceState({}, "", "/?tduid=abc123");
      captureTduid();
      initTradedoubler();
      const calls = recordCalls();
      document.cookie = "TRADEDOUBLER=cookie-value";

      teardownTradedoubler();

      expect(calls).toEqual([["tracking-consent", false]]);
      expect(document.cookie).not.toContain("TRADEDOUBLER=");
      expect(storedTduid()).toBeUndefined();
    });

    it("still clears the cookie and stored id when the SDK never loaded", () => {
      window.sessionStorage.setItem(TDUID_STORAGE_KEY, "kept");
      document.cookie = "TRADEDOUBLER=cookie-value";
      expect(() => teardownTradedoubler()).not.toThrow();
      expect(document.cookie).not.toContain("TRADEDOUBLER=");
      expect(storedTduid()).toBeUndefined();
    });
  });

  describe("trackTradedoublerSale", () => {
    const sale = {
      transactionId: "cs_test_1",
      orderValue: 111.99,
      voucher: "",
      currency: "GBP",
    };

    it("fires init (iframe) then the sale with the configured event id", () => {
      configure();
      initTradedoubler();
      const calls = recordCalls();

      trackTradedoublerSale(sale);

      expect(calls).toEqual([
        ["init", "123456", { element: "iframe" }],
        [
          "track",
          "sale",
          {
            transactionId: "cs_test_1",
            ordervalue: 111.99,
            voucher: "",
            currency: "GBP",
            event: "999999",
          },
        ],
      ]);
    });

    it("no-ops without consent, even with the SDK loaded", () => {
      configure();
      initTradedoubler();
      const calls = recordCalls();
      setConsent({ advertising: true, affiliate: false });
      trackTradedoublerSale(sale);
      expect(calls).toHaveLength(0);
    });

    it("no-ops when the SDK was never loaded", () => {
      configure();
      expect(() => trackTradedoublerSale(sale)).not.toThrow();
      expect(window.tdconv).toBeUndefined();
    });

    it("no-ops when the sale event id is unset", () => {
      configure();
      vi.stubEnv("VITE_TRADEDOUBLER_SALE_EVENT_ID", "");
      initTradedoubler();
      const calls = recordCalls();
      trackTradedoublerSale(sale);
      expect(calls).toHaveLength(0);
    });
  });
});
