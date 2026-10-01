/** @jest-environment node */
import { compileModsAsync } from "@expo/config-plugins";
import withTogetherLan from "../withTogetherLan";

async function evaluate(info: Record<string, unknown> = {}) {
  const config = withTogetherLan(
    withTogetherLan({ name: "test", slug: "test", ios: { infoPlist: info } }),
  );
  return compileModsAsync(config, {
    projectRoot: process.cwd(),
    platforms: ["ios", "android"],
    introspect: true,
    ignoreExistingNativeFiles: true,
  });
}

describe("Together LAN permissions", () => {
  it("adds Bonjour and local-network reason once without discarding existing entries", async () => {
    const result = await evaluate({
      NSBonjourServices: ["_other._tcp"],
      NSLocalNetworkUsageDescription: "Existing reason",
    });
    expect(result.ios?.infoPlist?.NSBonjourServices).toEqual([
      "_other._tcp",
      "_persist-tg._tcp",
    ]);
    expect(result.ios?.infoPlist?.NSLocalNetworkUsageDescription).toBe(
      "Existing reason",
    );
    expect(result.android?.permissions).toEqual([
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
    ]);
  });

  it("supplies a user-facing local-network purpose when absent", async () => {
    const result = await evaluate();
    expect(result.ios?.infoPlist?.NSBonjourServices).toEqual([
      "_persist-tg._tcp",
    ]);
    expect(result.ios?.infoPlist?.NSLocalNetworkUsageDescription).toContain(
      "without internet",
    );
  });
});
