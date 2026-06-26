import {
  HOME_ROUTE,
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

  it("falls back to Home for an unknown custom-scheme host", () => {
    expect(resolveNotificationRoute("persistencemobile://wat?x=1")).toBe(
      HOME_ROUTE,
    );
  });
});
