import { reportStoreClick } from "../storeClick";
import { setConsent } from "../consent";
import * as metaPixel from "../metaPixel";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });
}

describe("reportStoreClick", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCookies();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("returns an event id", () => {
    const eventId = reportStoreClick("ios");
    expect(typeof eventId).toBe("string");
    expect(eventId.length).toBeGreaterThan(0);
  });

  it("fires the browser pixel with the returned event id", () => {
    const spy = vi.spyOn(metaPixel, "trackStoreClick");
    const eventId = reportStoreClick("android");
    expect(spy).toHaveBeenCalledWith(eventId, "android");
  });

  it("sends a beacon via navigator.sendBeacon when available", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(typeof url).toBe("string");
    expect(url).toMatch(/\/store-click$/);
    expect(blob).toBeInstanceOf(Blob);
    // Must be a CORS-simple content-type or sendBeacon won't deliver it
    // cross-origin (it can't preflight an application/json body).
    expect((blob as Blob).type).toBe("text/plain");
  });

  it("includes marketing_consent: false when consent is unset", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("android");

    const [, blob] = sendBeacon.mock.calls[0];
    const text = await (blob as Blob).text();
    const body = JSON.parse(text);
    expect(body.marketing_consent).toBe(false);
    expect(body.store).toBe("android");
  });

  it("includes marketing_consent: true when consent is granted", async () => {
    setConsent({ advertising: true });
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios");

    const [, blob] = sendBeacon.mock.calls[0];
    const text = await (blob as Blob).text();
    const body = JSON.parse(text);
    expect(body.marketing_consent).toBe(true);
  });

  it("includes the captured referral code when present", async () => {
    window.sessionStorage.setItem("persistence.ref", "UON2026");
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios");

    const [, blob] = sendBeacon.mock.calls[0];
    const body = JSON.parse(await (blob as Blob).text());
    expect(body.ref).toBe("UON2026");
  });

  it("omits an invalid stored referral value", async () => {
    window.sessionStorage.setItem("persistence.ref", "bad!");
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios");

    const [, blob] = sendBeacon.mock.calls[0];
    const body = JSON.parse(await (blob as Blob).text());
    expect(body).not.toHaveProperty("ref");
  });

  it("includes the campaign slug the caller resolved from the route", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios", "meta");

    const [, blob] = sendBeacon.mock.calls[0];
    const body = JSON.parse(await (blob as Blob).text());
    expect(body.campaign).toBe("meta");
  });

  it("omits campaign entirely when the click came from no campaign route", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick("ios");

    const [, blob] = sendBeacon.mock.calls[0];
    const body = JSON.parse(await (blob as Blob).text());
    expect(body).not.toHaveProperty("campaign");
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", () => {
    const withoutBeacon: Record<string, unknown> = { ...navigator };
    delete withoutBeacon.sendBeacon;
    vi.stubGlobal("navigator", withoutBeacon);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    reportStoreClick("ios");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/store-click$/);
    expect(init).toMatchObject({ method: "POST", keepalive: true });
  });

  it("never throws even when the beacon send itself throws", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: () => {
        throw new Error("boom");
      },
    });

    expect(() => reportStoreClick("ios")).not.toThrow();
  });
});
