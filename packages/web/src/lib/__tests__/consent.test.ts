import {
  CONSENT_VERSION,
  clearMetaCookies,
  clearTradedoublerCookies,
  getChoices,
  hasConsent,
  isConsentDecided,
  setConsent,
  subscribe,
  type ConsentChoices,
} from "../consent";

const KEY = "persistence.consent.v3";

describe("consent (category model)", () => {
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

  it("is undecided with all categories off by default", () => {
    expect(isConsentDecided()).toBe(false);
    expect(getChoices()).toEqual({ advertising: false, affiliate: false });
    expect(hasConsent("advertising")).toBe(false);
    expect(hasConsent("affiliate")).toBe(false);
  });

  it("round-trips a per-category choice and marks it decided", () => {
    setConsent({ advertising: true, affiliate: false });
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(true);
    expect(hasConsent("affiliate")).toBe(false);

    setConsent({ advertising: false, affiliate: true });
    expect(isConsentDecided()).toBe(true); // a reject is still a decision
    expect(hasConsent("advertising")).toBe(false);
    expect(hasConsent("affiliate")).toBe(true);
  });

  it("stamps the current version and both categories on write", () => {
    setConsent({ advertising: true, affiliate: true });
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored).toEqual({
      v: CONSENT_VERSION,
      advertising: true,
      affiliate: true,
    });
  });

  it("is on version 3 since the affiliate category was added", () => {
    // The version is the scope-creep guard: adding `affiliate` had to bump it
    // so a v2 "Accept all" (advertising only) can never cover Tradedoubler.
    expect(CONSENT_VERSION).toBe(3);
  });

  it("re-prompts (reads as undecided) for a record from an older version", () => {
    // Scope-creep guard: a stale record from before a category was added must
    // NOT silently satisfy consent.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: CONSENT_VERSION - 1, advertising: true }),
    );
    expect(isConsentDecided()).toBe(false);
    expect(hasConsent("advertising")).toBe(false);
    expect(hasConsent("affiliate")).toBe(false);
  });

  it("does not read a v2 record stored under the old key as any consent", () => {
    window.localStorage.setItem(
      "persistence.consent.v2",
      JSON.stringify({ v: 2, advertising: true }),
    );
    expect(isConsentDecided()).toBe(false);
    expect(hasConsent("affiliate")).toBe(false);
  });

  it("reads a missing affiliate flag on a current-version record as off", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: CONSENT_VERSION, advertising: true }),
    );
    expect(getChoices()).toEqual({ advertising: true, affiliate: false });
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem(KEY, "not json");
    expect(isConsentDecided()).toBe(false);
    expect(hasConsent("advertising")).toBe(false);
  });

  it("notifies subscribers with the choices and stops after unsubscribe", () => {
    const seen: ConsentChoices[] = [];
    const unsub = subscribe((c) => seen.push(c));
    setConsent({ advertising: true, affiliate: true });
    unsub();
    setConsent({ advertising: false, affiliate: false });
    expect(seen).toEqual([{ advertising: true, affiliate: true }]);
  });

  it("degrades to undecided (never granted) when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(isConsentDecided()).toBe(false);
    expect(hasConsent("advertising")).toBe(false);
  });

  it("does not throw when setConsent's write is blocked, and still notifies", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    const seen: ConsentChoices[] = [];
    subscribe((c) => seen.push(c));
    expect(() =>
      setConsent({ advertising: true, affiliate: false }),
    ).not.toThrow();
    expect(seen).toEqual([{ advertising: true, affiliate: false }]);
  });

  it("clearMetaCookies expires _fbp and _fbc", () => {
    document.cookie = "_fbp=fb.1.1.abc";
    document.cookie = "_fbc=fb.1.1.xyz";
    clearMetaCookies();
    expect(document.cookie).not.toContain("_fbp=");
    expect(document.cookie).not.toContain("_fbc=");
  });

  it("clearTradedoublerCookies expires TRADEDOUBLER and nothing else", () => {
    document.cookie = "TRADEDOUBLER=abc123";
    document.cookie = "_fbp=fb.1.1.abc";
    clearTradedoublerCookies();
    expect(document.cookie).not.toContain("TRADEDOUBLER=");
    expect(document.cookie).toContain("_fbp=");
  });
});
