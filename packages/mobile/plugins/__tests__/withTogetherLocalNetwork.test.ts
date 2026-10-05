/** @jest-environment node */
import { compileModsAsync } from "@expo/config-plugins";
import withTogetherLan from "../withTogetherLan";
import withNearby from "../../modules/together-nearby/plugin/withTogetherNearby";

it.each([undefined, 36, 37, 38])(
  "generates local-network permission only for an explicit target >=37 (%s)",
  async (target) => {
    for (const plugin of [withTogetherLan, withNearby]) {
      const config = plugin(
        plugin({
          name: "fixture",
          slug: "fixture",
          plugins:
            target === undefined
              ? []
              : [
                  [
                    "expo-build-properties",
                    { android: { targetSdkVersion: target } },
                  ],
                ],
        }),
      );
      const result = await compileModsAsync(config, {
        projectRoot: process.cwd(),
        platforms: ["android"],
        introspect: true,
        ignoreExistingNativeFiles: true,
      });
      const permissions = result.android?.permissions ?? [];
      expect(
        permissions.filter(
          (p: string) => p === "android.permission.ACCESS_LOCAL_NETWORK",
        ),
      ).toHaveLength(target !== undefined && target >= 37 ? 1 : 0);
    }
  },
);
