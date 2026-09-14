import { describe, it, expect } from "vitest";
import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import { membershipTierLabel, isCoachMembership } from "../membershipTier";
describe("membership display", () => {
  it.each(GRANTABLE_TIERS)("labels $id correctly", (tier) => {
    expect(membershipTierLabel(tier.id)).toBe(tier.name);
    expect(isCoachMembership(tier.id)).toBe(tier.audience === "coach");
  });
  it("preserves unknown IDs rather than displaying an incorrect Premium label", () => {
    expect(membershipTierLabel("custom-plan")).toBe("custom-plan");
    expect(isCoachMembership("custom-plan")).toBe(false);
  });
});
