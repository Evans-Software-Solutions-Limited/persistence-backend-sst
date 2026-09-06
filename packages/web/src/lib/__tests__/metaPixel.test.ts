import {
  initMetaPixel,
  trackPageView,
  trackLead,
  trackStoreClick,
  getFbc,
  getFbp,
  newEventId,
  trackInitiateCheckout,
  trackPurchase,
} from "../metaPixel";
import { setConsent } from "../consent";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });
}

describe("metaPixel", () => {
  beforeEach(() => {
    // The pixel is consent-gated (spec-30 R3.5). Most cases below exercise the
    // loaded pixel, so default to granted and let the gate-specific tests
    // override. afterEach clears storage back to "unset".
    setConsent({ advertising: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { fbq?: unknown }).fbq;
    delete (window as unknown as { _fbq?: unknown })._fbq;
    document.head
      .querySelectorAll('script[src*="connect.facebook.net"]')
      .forEach((el) => el.remove());
    clearCookies();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  describe("initMetaPixel", () => {
    it("no-ops when VITE_META_PIXEL_ID is unset", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "");
      initMetaPixel();
      expect(window.fbq).toBeUndefined();
      expect(
        document.head.querySelector('script[src*="connect.facebook.net"]'),
      ).toBeNull();
    });

    it("injects the pixel script + fbq('init', id) when an id is configured", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();

      expect(window.fbq).toBeDefined();
      expect(window.fbq!.loaded).toBe(true);
      const script = document.head.querySelector<HTMLScriptElement>(
        'script[src*="connect.facebook.net"]',
      );
      expect(script).not.toBeNull();
      expect(script!.src).toBe(
        "https://connect.facebook.net/en_US/fbevents.js",
      );
    });

    it("is idempotent — a second call does not inject a second script", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      initMetaPixel();
      const scripts = document.head.querySelectorAll(
        'script[src*="connect.facebook.net"]',
      );
      expect(scripts.length).toBe(1);
    });

    it("no-ops without consent even when an id is configured (R3.5)", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      setConsent({ advertising: false });
      initMetaPixel();
      expect(window.fbq).toBeUndefined();
      expect(
        document.head.querySelector('script[src*="connect.facebook.net"]'),
      ).toBeNull();
    });

    it("no-ops when consent is unset (the default first-visit state)", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      window.localStorage.clear(); // → "unset"
      initMetaPixel();
      expect(window.fbq).toBeUndefined();
    });
  });

  describe("trackPageView / trackLead", () => {
    it("no-op before the pixel is loaded", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "");
      expect(() => trackPageView()).not.toThrow();
      expect(() => trackLead("evt_1")).not.toThrow();
    });

    it("call fbq('track', ...) once the pixel is loaded", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      const calls: unknown[][] = [];
      window.fbq = Object.assign(
        (...args: unknown[]) => calls.push(args),
        window.fbq,
      );

      trackPageView();
      trackLead("evt_42");

      expect(calls[0]).toEqual(["track", "PageView"]);
      expect(calls[1]).toEqual(["track", "Lead", {}, { eventID: "evt_42" }]);
    });

    it("stop firing after consent is withdrawn, even though fbq is still loaded (R3.5)", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      const calls: unknown[][] = [];
      window.fbq = Object.assign(
        (...args: unknown[]) => calls.push(args),
        window.fbq,
      );

      setConsent({ advertising: false }); // withdrawal — the script can't be unloaded
      trackPageView();
      trackLead("evt_x");

      expect(calls).toHaveLength(0);
    });
  });

  describe("trackStoreClick", () => {
    it("no-ops without consent", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      setConsent({ advertising: false });
      expect(() => trackStoreClick("evt_store", "ios")).not.toThrow();
      expect(window.fbq).toBeUndefined();
    });

    it("fires AppStoreClick with store custom data and a dedup eventID", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      const calls: unknown[][] = [];
      window.fbq = Object.assign(
        (...args: unknown[]) => calls.push(args),
        window.fbq,
      );

      trackStoreClick("evt_store", "android");

      expect(calls).toEqual([
        [
          "trackCustom",
          "AppStoreClick",
          { store: "android" },
          { eventID: "evt_store" },
        ],
      ]);
    });
  });

  describe("trackInitiateCheckout / trackPurchase", () => {
    it.each([
      ["trackInitiateCheckout", trackInitiateCheckout],
      ["trackPurchase", trackPurchase],
    ])("%s no-ops without consent", (_name, fire) => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      setConsent({ advertising: false });
      expect(() => fire("evt_1", 30, "GBP")).not.toThrow();
      expect(window.fbq).toBeUndefined();
    });

    it.each([
      ["trackInitiateCheckout", trackInitiateCheckout],
      ["trackPurchase", trackPurchase],
    ])("%s no-ops when the pixel never loaded", (_name, fire) => {
      // No pixel id configured, so `initMetaPixel` never ran.
      expect(() => fire("evt_1", 30, "GBP")).not.toThrow();
      expect(window.fbq).toBeUndefined();
    });

    it("fires InitiateCheckout with value, currency and a dedup eventID", () => {
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      const calls: unknown[][] = [];
      window.fbq = Object.assign(
        (...args: unknown[]) => calls.push(args),
        window.fbq,
      );

      trackInitiateCheckout("evt_checkout", 30, "GBP");

      expect(calls).toEqual([
        [
          "track",
          "InitiateCheckout",
          { value: 30, currency: "GBP" },
          { eventID: "evt_checkout" },
        ],
      ]);
    });

    it("fires Purchase with the id the server already used", () => {
      // A fresh id here would send Meta two unlinked purchases for one sale.
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      initMetaPixel();
      const calls: unknown[][] = [];
      window.fbq = Object.assign(
        (...args: unknown[]) => calls.push(args),
        window.fbq,
      );

      trackPurchase("evt_from_server", 60, "GBP");

      expect(calls).toEqual([
        [
          "track",
          "Purchase",
          { value: 60, currency: "GBP" },
          { eventID: "evt_from_server" },
        ],
      ]);
    });
  });

  describe("getFbc", () => {
    it("returns null when there is no fbclid param and no _fbc cookie", () => {
      expect(getFbc()).toBeNull();
    });

    it("formats a fresh fbclid into the standard fbc shape", () => {
      window.history.replaceState({}, "", "/?fbclid=abc123");
      const fbc = getFbc();
      expect(fbc).toMatch(/^fb\.1\.\d+\.abc123$/);
    });

    it("falls back to the _fbc cookie when there is no fbclid param", () => {
      document.cookie = "_fbc=fb.1.1690000000000.storedclid";
      expect(getFbc()).toBe("fb.1.1690000000000.storedclid");
    });
  });

  describe("getFbp", () => {
    it("returns null when the _fbp cookie is absent", () => {
      expect(getFbp()).toBeNull();
    });

    it("reads the _fbp cookie", () => {
      document.cookie = "_fbp=fb.1.1690000000000.999888777";
      expect(getFbp()).toBe("fb.1.1690000000000.999888777");
    });
  });

  describe("newEventId", () => {
    it("returns unique values", () => {
      const a = newEventId();
      const b = newEventId();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });
});
