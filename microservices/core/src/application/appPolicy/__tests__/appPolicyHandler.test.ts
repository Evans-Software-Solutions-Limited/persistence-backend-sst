import { afterEach, expect, it, vi } from "vitest";
import { appPolicyHandler } from "../appPolicyHandler";
afterEach(() => vi.unstubAllEnvs());
it("publishes the release floor without authentication or Together activation", async () => {
  vi.stubEnv("APP_MIN_IOS_VERSION", "");
  vi.stubEnv("APP_MIN_ANDROID_VERSION", "");
  vi.stubEnv("TOGETHER_ENABLED", "false");
  const r = await appPolicyHandler.handle(
    new Request("http://localhost/app-policy"),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.json()).toEqual({
    iosMinimumVersion: "1.1.3",
    androidMinimumVersion: "1.1.3",
  });
});
it("supports independent platform rollout floors", async () => {
  vi.stubEnv("APP_MIN_IOS_VERSION", "1.2.0");
  vi.stubEnv("APP_MIN_ANDROID_VERSION", "2.0.1");
  expect(
    await (
      await appPolicyHandler.handle(new Request("http://localhost/app-policy"))
    ).json(),
  ).toEqual({ iosMinimumVersion: "1.2.0", androidMinimumVersion: "2.0.1" });
});
it.each([
  ["bad", "1.1.3"],
  ["1.1.3", "1.2"],
  ["01.2.3", "1.2.3"],
])("rejects malformed operator policy %s/%s", async (ios, android) => {
  vi.stubEnv("APP_MIN_IOS_VERSION", ios);
  vi.stubEnv("APP_MIN_ANDROID_VERSION", android);
  const r = await appPolicyHandler.handle(
    new Request("http://localhost/app-policy"),
  );
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({
    error: "App version policy is unavailable",
  });
});
