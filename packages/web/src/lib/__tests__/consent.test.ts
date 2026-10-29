import {
  CONSENT_VERSION,
  clearMetaCookies,
  getChoices,
  hasConsent,
  isConsentDecided,
  setConsent,
  subscribe,
  type ConsentChoices,
} from "../consent";

const KEY = "persistence.consent.v2";

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
    expect(getChoices()).toEqual({ advertising: false });
    expect(hasConsent("advertising")).toBe(false);
  });

  it("round-trips a per-category choice and marks it decided", () => {
    setConsent({ advertising: true });
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(true);

    setConsent({ advertising: false });
    expect(isConsentDecided()).toBe(true); // a reject is still a decision
    expect(hasConsent("advertising")).toBe(false);
  });

  it("stamps the current version on write", () => {
    setConsent({ advertising: true });
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored).toEqual({ v: CONSENT_VERSION, advertising: true });
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
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem(KEY, "not json");
    expect(isConsentDecided()).toBe(false);
    expect(hasConsent("advertising")).toBe(false);
  });

  it("notifies subscribers with the choices and stops after unsubscribe", () => {
    const seen: ConsentChoices[] = [];
    const unsub = subscribe((c) => seen.push(c));
    setConsent({ advertising: true });
    unsub();
    setConsent({ advertising: false });
    expect(seen).toEqual([{ advertising: true }]);
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
    expect(() => setConsent({ advertising: true })).not.toThrow();
    expect(seen).toEqual([{ advertising: true }]);
  });

  it("clearMetaCookies expires _fbp and _fbc", () => {
    document.cookie = "_fbp=fb.1.1.abc";
    document.cookie = "_fbc=fb.1.1.xyz";
    clearMetaCookies();
    expect(document.cookie).not.toContain("_fbp=");
    expect(document.cookie).not.toContain("_fbc=");
  });
});
