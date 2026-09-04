import { describe, expect, it } from "vitest";
import {
  isValidReferralCode,
  normalizeReferralCode,
  suggestReferralCode,
} from "../referralCode";

describe("referral code normalisation", () => {
  it("upper-cases and strips spaces, hyphens and underscores", () => {
    expect(normalizeReferralCode(" uon freshers ")).toBe("UONFRESHERS");
    expect(normalizeReferralCode("UON-FRESHERS")).toBe("UONFRESHERS");
    expect(normalizeReferralCode("uon_freshers")).toBe("UONFRESHERS");
  });

  it("validates 4–24 alphanumerics only", () => {
    expect(isValidReferralCode("ABCD")).toBe(true);
    expect(isValidReferralCode("ABC")).toBe(false);
    expect(isValidReferralCode("A".repeat(25))).toBe(false);
    expect(isValidReferralCode("AB!D")).toBe(false);
    expect(isValidReferralCode("abcd")).toBe(false); // must be canonical
  });

  it("suggests a code from a label, capped at 24", () => {
    expect(suggestReferralCode("Uni of Nottingham freshers")).toBe(
      "UNIOFNOTTINGHAMFRESHERS",
    );
    expect(
      suggestReferralCode("A very long label that keeps going and going"),
    ).toHaveLength(24);
  });
});
