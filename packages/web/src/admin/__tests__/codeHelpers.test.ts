import { shareLink, suggestCode, suggestPlanSlug } from "../codeHelpers";
import type { ReferralCodeRow } from "../adminApi";

const code = {
  code: "UONFAIR",
  campaignSlug: "uon",
} as ReferralCodeRow;

describe("suggestCode", () => {
  it("turns a label into a code word of the allowed shape", () => {
    expect(suggestCode("UoN freshers fair")).toBe("UONFRESHERSFAIR");
  });

  it("truncates to the 24 characters the column allows", () => {
    expect(suggestCode("a".repeat(40))).toHaveLength(24);
  });
});

describe("shareLink", () => {
  it("points at the code's own campaign landing route", () => {
    expect(shareLink(code, "https://example.com")).toBe(
      "https://example.com/qr/uon?ref=UONFAIR",
    );
  });

  it("falls back to the /qr bucket for a code with no campaign", () => {
    expect(
      shareLink({ ...code, campaignSlug: null }, "https://example.com"),
    ).toBe("https://example.com/qr/default?ref=UONFAIR");
  });

  it("escapes the code rather than pasting it into the query raw", () => {
    expect(shareLink({ ...code, code: "A B&C" }, "https://example.com")).toBe(
      "https://example.com/qr/uon?ref=A%20B%26C",
    );
  });
});

describe("suggestPlanSlug", () => {
  it("turns a plan name into a legal slug", () => {
    expect(suggestPlanSlug("Founders' offer — Sep 2026")).toBe(
      "founders-offer-sep-2026",
    );
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(suggestPlanSlug("— Meta —")).toBe("meta");
  });

  it("truncates to the 48 characters the column allows", () => {
    expect(suggestPlanSlug("x".repeat(80))).toHaveLength(48);
  });
});
