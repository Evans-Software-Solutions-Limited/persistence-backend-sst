/** @jest-environment node */
import { AndroidConfig } from "@expo/config-plugins";
import withAndroidPortraitActivity from "../withAndroidPortraitActivity";

const { setPortraitActivity } = withAndroidPortraitActivity;

type Manifest = Parameters<
  typeof AndroidConfig.Manifest.getMainActivityOrThrow
>[0];

function manifest(): Manifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: { "android:name": ".MainActivity" },
              "intent-filter": [
                {
                  action: [
                    { $: { "android:name": "android.intent.action.MAIN" } },
                  ],
                  category: [
                    {
                      $: { "android:name": "android.intent.category.LAUNCHER" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as Manifest;
}

describe("withAndroidPortraitActivity (PER-137)", () => {
  it("keeps the main activity portrait after Expo writes 'unspecified' for orientation: default", () => {
    // Expo's own orientation mod runs first (it registers after user
    // plugins) and writes `unspecified` for `orientation: "default"`.
    const afterExpo = AndroidConfig.Orientation.setAndroidOrientation(
      { orientation: "default" } as never,
      manifest(),
    );
    expect(
      AndroidConfig.Manifest.getMainActivityOrThrow(afterExpo).$[
        "android:screenOrientation"
      ],
    ).toBe("unspecified");
    const result = setPortraitActivity(afterExpo);
    expect(
      AndroidConfig.Manifest.getMainActivityOrThrow(result).$[
        "android:screenOrientation"
      ],
    ).toBe("portrait");
  });

  it("registers an Android manifest mod and leaves iOS alone", () => {
    const config = withAndroidPortraitActivity({ name: "t", slug: "t" }) as {
      mods?: { android?: { manifest?: unknown }; ios?: unknown };
    };
    expect(typeof config.mods?.android?.manifest).toBe("function");
    expect(config.mods?.ios).toBeUndefined();
  });
});
