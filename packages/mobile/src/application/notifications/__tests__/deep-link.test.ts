import {
  HOME_ROUTE,
  TRAIN_ROUTE,
  redirectSystemPathForDeepLink,
  resolveNotificationRoute,
} from "@/application/notifications/deep-link";

describe("resolveNotificationRoute", () => {
  it("falls back to Home for null / undefined / empty", () => {
    expect(resolveNotificationRoute(null)).toBe(HOME_ROUTE);
    expect(resolveNotificationRoute(undefined)).toBe(HOME_ROUTE);
    expect(resolveNotificationRoute("")).toBe(HOME_ROUTE);
    expect(resolveNotificationRoute("   ")).toBe(HOME_ROUTE);
  });

  it("remaps legacy paths to current routes", () => {
    expect(resolveNotificationRoute("/progress")).toBe("/(app)/(tabs)/you");
    expect(resolveNotificationRoute("/notifications")).toBe(
      "/(app)/notifications",
    );
    expect(resolveNotificationRoute("/profile/notifications")).toBe(
      "/(app)/profile/notifications",
    );
  });

  it("passes through an already-absolute app path", () => {
    expect(resolveNotificationRoute("/(app)/(tabs)/you")).toBe(
      "/(app)/(tabs)/you",
    );
    expect(resolveNotificationRoute("/(app)/workouts/abc")).toBe(
      "/(app)/workouts/abc",
    );
  });

  it("falls back to Home for an unknown non-absolute link", () => {
    expect(resolveNotificationRoute("garbage")).toBe(HOME_ROUTE);
  });

  it("maps custom-scheme links to in-app routes", () => {
    expect(
      resolveNotificationRoute(
        "persistencemobile://requests?relationshipId=rel-1",
      ),
    ).toBe("/(app)/requests?relationshipId=rel-1");
    expect(resolveNotificationRoute("persistencemobile://requests")).toBe(
      "/(app)/requests",
    );
    expect(
      resolveNotificationRoute("persistencemobile://clients?clientId=c-1"),
    ).toBe("/(app)/(tabs)/clients?clientId=c-1");
    expect(resolveNotificationRoute("persistencemobile://profile")).toBe(
      "/(app)/(tabs)/you",
    );
  });

  it("maps the M17 train host to the Train hub route", () => {
    expect(resolveNotificationRoute("persistencemobile://train")).toBe(
      TRAIN_ROUTE,
    );
    expect(TRAIN_ROUTE).toBe("/(app)/(tabs)/train");
  });

  it("falls back to Home for an unknown custom-scheme host", () => {
    expect(resolveNotificationRoute("persistencemobile://wat?x=1")).toBe(
      HOME_ROUTE,
    );
  });

  it("maps the Phase 8 accept-invite host to the athlete redeem route, preserving the query string", () => {
    expect(
      resolveNotificationRoute("persistencemobile://accept-invite?code=AB23CD"),
    ).toBe("/(app)/accept-invite?code=AB23CD");
    expect(resolveNotificationRoute("persistencemobile://accept-invite")).toBe(
      "/(app)/accept-invite",
    );
  });
});

describe("redirectSystemPathForDeepLink", () => {
  it("rewrites a full custom-scheme host-form URL, preserving the query", () => {
    expect(
      redirectSystemPathForDeepLink(
        "persistencemobile://accept-invite?code=AB23CD",
      ),
    ).toBe("/(app)/accept-invite?code=AB23CD");
  });

  it("rewrites the Linking.createURL canonical (leading-slash) form", () => {
    expect(
      redirectSystemPathForDeepLink(
        "persistencemobile:///accept-invite?code=AB23CD",
      ),
    ).toBe("/(app)/accept-invite?code=AB23CD");
  });

  it("rewrites the bare host-form path Expo Router hands the redirect", () => {
    expect(redirectSystemPathForDeepLink("accept-invite?code=AB23CD")).toBe(
      "/(app)/accept-invite?code=AB23CD",
    );
  });

  it("rewrites the bare leading-slash path form", () => {
    expect(redirectSystemPathForDeepLink("/accept-invite?code=AB23CD")).toBe(
      "/(app)/accept-invite?code=AB23CD",
    );
  });

  it("maps a known host with no query string", () => {
    expect(redirectSystemPathForDeepLink("accept-invite")).toBe(
      "/(app)/accept-invite",
    );
    expect(redirectSystemPathForDeepLink("requests?relationshipId=rel-1")).toBe(
      "/(app)/requests?relationshipId=rel-1",
    );
  });

  it("returns an unrecognised path UNCHANGED so Expo Router can match it", () => {
    expect(redirectSystemPathForDeepLink("/(app)/(tabs)/you")).toBe(
      "/(app)/(tabs)/you",
    );
    expect(redirectSystemPathForDeepLink("/some/unknown/route")).toBe(
      "/some/unknown/route",
    );
    expect(redirectSystemPathForDeepLink("wat?x=1")).toBe("wat?x=1");
    // A normal cold launch hands the redirect the root path — pass it through.
    expect(redirectSystemPathForDeepLink("/")).toBe("/");
  });

  it("falls back to Home for null / undefined / empty", () => {
    expect(redirectSystemPathForDeepLink(null)).toBe(HOME_ROUTE);
    expect(redirectSystemPathForDeepLink(undefined)).toBe(HOME_ROUTE);
    expect(redirectSystemPathForDeepLink("")).toBe(HOME_ROUTE);
  });
});
