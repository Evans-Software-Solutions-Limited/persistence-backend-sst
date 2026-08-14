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
    window.history.replaceState({}, "", "/");
  });

  it("returns an event id", () => {
    const eventId = reportStoreClick();
    expect(typeof eventId).toBe("string");
    expect(eventId.length).toBeGreaterThan(0);
  });

  it("fires the browser pixel with the returned event id", () => {
    const spy = vi.spyOn(metaPixel, "trackAppStoreClick");
    const eventId = reportStoreClick();
    expect(spy).toHaveBeenCalledWith(eventId);
  });

  it("sends a beacon via navigator.sendBeacon when available", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick();

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

    reportStoreClick();

    const [, blob] = sendBeacon.mock.calls[0];
    const text = await (blob as Blob).text();
    const body = JSON.parse(text);
    expect(body.marketing_consent).toBe(false);
  });

  it("includes marketing_consent: true when consent is granted", async () => {
    setConsent("granted");
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    reportStoreClick();

    const [, blob] = sendBeacon.mock.calls[0];
    const text = await (blob as Blob).text();
    const body = JSON.parse(text);
    expect(body.marketing_consent).toBe(true);
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", () => {
    const withoutBeacon: Record<string, unknown> = { ...navigator };
    delete withoutBeacon.sendBeacon;
    vi.stubGlobal("navigator", withoutBeacon);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    reportStoreClick();

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

    expect(() => reportStoreClick()).not.toThrow();
  });
});
