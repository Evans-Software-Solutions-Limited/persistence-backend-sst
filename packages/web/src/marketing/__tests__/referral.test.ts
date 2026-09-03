import {
  normalizeReferralCode,
  REFERRAL_STORAGE_KEY,
  storedReferralCode,
  storeReferralCode,
} from "../referral";

describe("marketing referral helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("normalises spaces and hyphens and rejects unsupported codes", () => {
    expect(normalizeReferralCode(" fresh-ers 26 ")).toBe("FRESHERS26");
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode("abc")).toBeNull();
    expect(normalizeReferralCode("BAD!CODE")).toBeNull();
  });

  it("reads only a valid stored code", () => {
    window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, " valid-24 ");
    expect(storedReferralCode()).toBe("VALID24");
    window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, "bad!");
    expect(storedReferralCode()).toBeUndefined();
  });

  it("fails safely when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(storedReferralCode()).toBeUndefined();
    expect(() => storeReferralCode("VALID24")).not.toThrow();
  });

  it("returns no stored code outside a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(storedReferralCode()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
