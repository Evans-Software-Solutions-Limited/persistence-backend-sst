/** @jest-environment node */
import {
  compileModsAsync,
  type ExportedConfig,
  type Mod,
} from "@expo/config-plugins";
import withNearby, { patchPodfile } from "../plugin/withTogetherNearby";
it("patches owner post_install once and preserves existing work", () => {
  const original =
    "target 'App' do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend\n";
  const patched = patchPodfile(original);
  expect(patchPodfile(patched)).toBe(patched);
  expect(patched).toContain("PersistenceTogetherNearby.install(installer)");
  expect(patched).toContain("react_native_post_install(installer)");
  expect(() => patchPodfile("no hook")).toThrow("exactly one");
  expect(() => patchPodfile(original + original)).toThrow("exactly one");
});
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
it("applies the Nearby hook through the registered Podfile mod", async () => {
  const config: ExportedConfig = withNearby({
    name: "fixture",
    slug: "fixture",
  });
  // Expo registers Podfile mods at runtime but omits them from ExportedConfig.
  const action = (
    config.mods?.ios as
      | {
          podfile?: Mod<{ contents: string; language: "rb" }>;
        }
      | undefined
  )?.podfile;
  if (!action) throw new Error("Missing Podfile mod");
  const contents =
    "post_install do |installer|\n  react_native_post_install(installer)\nend\n";
  const result = await action({
    ...config,
    modResults: { contents, language: "rb" },
    modRequest: {
      projectRoot: "/fixture",
      platformProjectRoot: "/fixture/ios",
      platform: "ios",
      modName: "podfile",
      introspect: false,
    },
    modRawConfig: config,
  });
  expect(result.modResults.contents).toBe(patchPodfile(contents));
});
