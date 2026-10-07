/** @jest-environment node */
import { compileModsAsync, type ExportedConfig } from "@expo/config-plugins";
import withNearby from "../plugin/withTogetherNearby";
it("merges Bluetooth and Bonjour permissions without overwriting user text", async () => {
  const config = withNearby(
    withNearby({
      name: "fixture",
      slug: "fixture",
      ios: {
        infoPlist: {
          NSBluetoothAlwaysUsageDescription: "Existing",
          NSBonjourServices: ["_other._tcp"],
        },
      },
    }),
  );
  const result = await compileModsAsync(config, {
    projectRoot: process.cwd(),
    platforms: ["ios"],
    introspect: true,
    ignoreExistingNativeFiles: true,
  });
  expect(result.ios?.infoPlist?.NSBluetoothAlwaysUsageDescription).toBe(
    "Existing",
  );
  expect(result.ios?.infoPlist?.NSBonjourServices).toHaveLength(2);
  expect(result.ios?.infoPlist?.NSBonjourServices).toContain("_other._tcp");
});
it("leaves Podfile registration to React Native", () => {
  const config: ExportedConfig = withNearby({
    name: "fixture",
    slug: "fixture",
  });
  expect(Object.keys(config.mods?.ios ?? {})).not.toContain("podfile");
});
it("supplies defaults without existing Info.plist values", async () => {
  const config = withNearby({ name: "fixture", slug: "fixture" });
  const result = await compileModsAsync(config, {
    projectRoot: process.cwd(),
    platforms: ["ios"],
    introspect: true,
    ignoreExistingNativeFiles: true,
  });
  expect(result.ios?.infoPlist?.NSBonjourServices).toHaveLength(1);
  expect(result.ios?.infoPlist?.NSBluetoothAlwaysUsageDescription).toContain(
    "Together",
  );
  expect(result.ios?.infoPlist?.NSLocalNetworkUsageDescription).toContain(
    "Together",
  );
});
