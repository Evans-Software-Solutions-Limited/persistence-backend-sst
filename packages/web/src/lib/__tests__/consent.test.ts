import {
  clearMetaCookies,
  getConsent,
  setConsent,
  subscribe,
} from "../consent";

describe("consent", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    document.cookie.split(";").forEach((c) => {
      const name = c.split("=")[0]?.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
  });

  it("defaults to 'unset'", () => {
    expect(getConsent()).toBe("unset");
  });

  it("round-trips granted and denied", () => {
    setConsent("granted");
    expect(getConsent()).toBe("granted");
    setConsent("denied");
    expect(getConsent()).toBe("denied");
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem("persistence.consent.marketing.v1", "banana");
    expect(getConsent()).toBe("unset");
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const seen: string[] = [];
    const unsub = subscribe((s) => seen.push(s));
    setConsent("granted");
    unsub();
    setConsent("denied");
    expect(seen).toEqual(["granted"]);
  });

  it("degrades to 'unset' (never 'granted') when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(getConsent()).toBe("unset");
  });

  it("does not throw when setConsent's write is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    const seen: string[] = [];
    subscribe((s) => seen.push(s));
    expect(() => setConsent("granted")).not.toThrow();
    // the in-memory notification still fires so the current page reacts
    expect(seen).toEqual(["granted"]);
  });

  it("clearMetaCookies expires _fbp and _fbc", () => {
    document.cookie = "_fbp=fb.1.1.abc";
    document.cookie = "_fbc=fb.1.1.xyz";
    clearMetaCookies();
    expect(document.cookie).not.toContain("_fbp=");
    expect(document.cookie).not.toContain("_fbc=");
  });
});
