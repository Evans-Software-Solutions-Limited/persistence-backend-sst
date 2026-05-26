import {
  parseEntitlementDeniedResponseBody,
  parseEntitlementDeniedResponseText,
} from "@/shared/errors/parseEntitlement";

describe("parseEntitlementDeniedResponseBody", () => {
  const fullBody = {
    code: "ENTITLEMENT_DENIED",
    error: "Subscription does not include this feature",
    feature: "create_workout",
    current_tier: "premium",
    upgrade_to: "premium",
    upgrade_price_monthly: 12.99,
  };

  it("parses a valid 402 body into camelCase payload", () => {
    expect(parseEntitlementDeniedResponseBody(fullBody)).toEqual({
      feature: "create_workout",
      currentTier: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
  });

  it("accepts null upgrade_to (already top tier) and null upgrade_price_monthly", () => {
    expect(
      parseEntitlementDeniedResponseBody({
        ...fullBody,
        upgrade_to: null,
        upgrade_price_monthly: null,
      }),
    ).toEqual({
      feature: "create_workout",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("returns null when body is null or non-object", () => {
    expect(parseEntitlementDeniedResponseBody(null)).toBeNull();
    expect(parseEntitlementDeniedResponseBody("not-an-object")).toBeNull();
    expect(parseEntitlementDeniedResponseBody(42)).toBeNull();
    expect(parseEntitlementDeniedResponseBody(undefined)).toBeNull();
  });

  it("returns null when code is missing or not the expected value", () => {
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, code: "OTHER" }),
    ).toBeNull();
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, code: undefined }),
    ).toBeNull();
  });

  it("returns null when feature is missing or not a string", () => {
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, feature: 42 }),
    ).toBeNull();
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, feature: undefined }),
    ).toBeNull();
  });

  it("returns null when current_tier is missing or not a string", () => {
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, current_tier: null }),
    ).toBeNull();
  });

  it("returns null when upgrade_to is not null and not a string", () => {
    expect(
      parseEntitlementDeniedResponseBody({ ...fullBody, upgrade_to: 42 }),
    ).toBeNull();
  });

  it("returns null when upgrade_price_monthly is not null and not a number", () => {
    expect(
      parseEntitlementDeniedResponseBody({
        ...fullBody,
        upgrade_price_monthly: "12.99",
      }),
    ).toBeNull();
  });
});

describe("parseEntitlementDeniedResponseText", () => {
  it("parses a valid JSON-stringified body", () => {
    const text = JSON.stringify({
      code: "ENTITLEMENT_DENIED",
      feature: "ai_workout",
      current_tier: "free",
      upgrade_to: "premium",
      upgrade_price_monthly: 12.99,
    });
    expect(parseEntitlementDeniedResponseText(text)).toEqual({
      feature: "ai_workout",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
  });

  it("returns null when text is not valid JSON", () => {
    expect(parseEntitlementDeniedResponseText("not json")).toBeNull();
    expect(parseEntitlementDeniedResponseText("")).toBeNull();
    expect(parseEntitlementDeniedResponseText("<html>oops</html>")).toBeNull();
  });

  it("returns null when JSON is valid but shape is wrong", () => {
    expect(
      parseEntitlementDeniedResponseText(JSON.stringify({ error: "some" })),
    ).toBeNull();
  });
});
