import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

import getConfig, { resolveGoogleServicesFile } from "../app.config";

/**
 * `app.config.ts` extends `app.json` via the `({ config })` dynamic-config
 * form. This stub mirrors the shape Expo hands in as `config` (the loaded
 * `app.json`'s `expo` object) — enough of it to prove the per-variant
 * override merges correctly without dropping unrelated fields.
 */
const BASE_CONFIG: ExpoConfig = {
  name: "persistence-mobile",
  slug: "persistence",
  version: "1.1.1",
  scheme: "persistencemobile",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.bradleyevans96.persistence",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.bradleyevans96.persistence",
    adaptiveIcon: { backgroundColor: "#0C111A" },
  },
  extra: {
    eas: {
      projectId: "255d542d-8dae-43c9-8d98-d9a3a325a470",
    },
  },
};

function invoke(): ExpoConfig {
  return getConfig({ config: BASE_CONFIG } as ConfigContext);
}

describe("app.config.ts", () => {
  const originalVariant = process.env.APP_VARIANT;
  const originalMetaAppId = process.env.EXPO_PUBLIC_META_APP_ID;
  const originalMetaClientToken = process.env.EXPO_PUBLIC_META_CLIENT_TOKEN;

  // The Firebase files are not committed yet, so every config read here warns
  // that Android push is off (covered in the PER-149 block below).
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalVariant === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = originalVariant;
    }
    if (originalMetaAppId === undefined)
      delete process.env.EXPO_PUBLIC_META_APP_ID;
    else process.env.EXPO_PUBLIC_META_APP_ID = originalMetaAppId;
    if (originalMetaClientToken === undefined)
      delete process.env.EXPO_PUBLIC_META_CLIENT_TOKEN;
    else process.env.EXPO_PUBLIC_META_CLIENT_TOKEN = originalMetaClientToken;
  });

  it("defaults to the production variant when APP_VARIANT is unset", () => {
    delete process.env.APP_VARIANT;
    const result = invoke();
    expect(result.name).toBe("persistence-mobile");
    expect(result.scheme).toBe("persistencemobile");
    expect(result.ios?.bundleIdentifier).toBe("com.bradleyevans96.persistence");
    expect(result.android?.package).toBe("com.bradleyevans96.persistence");
  });

  it("resolves the staging variant", () => {
    process.env.APP_VARIANT = "staging";
    const result = invoke();
    expect(result.name).toBe("Persistence (Staging)");
    expect(result.scheme).toBe("persistencemobile-staging");
    expect(result.ios?.bundleIdentifier).toBe(
      "com.bradleyevans96.persistence.staging",
    );
    expect(result.android?.package).toBe(
      "com.bradleyevans96.persistence.staging",
    );
  });

  it("resolves the production variant explicitly", () => {
    process.env.APP_VARIANT = "production";
    const result = invoke();
    expect(result.name).toBe("persistence-mobile");
    expect(result.scheme).toBe("persistencemobile");
    expect(result.ios?.bundleIdentifier).toBe("com.bradleyevans96.persistence");
    expect(result.android?.package).toBe("com.bradleyevans96.persistence");
  });

  it("falls back to production for an unknown APP_VARIANT", () => {
    process.env.APP_VARIANT = "some-unknown-variant";
    const result = invoke();
    expect(result.name).toBe("persistence-mobile");
    expect(result.scheme).toBe("persistencemobile");
    expect(result.ios?.bundleIdentifier).toBe("com.bradleyevans96.persistence");
    expect(result.android?.package).toBe("com.bradleyevans96.persistence");
  });

  it("sets EAS Update url + appVersion runtime policy (all variants share the one EAS project)", () => {
    for (const v of [undefined, "staging", "production"]) {
      if (v === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = v;
      const result = invoke();
      expect(result.updates?.url).toBe(
        "https://u.expo.dev/255d542d-8dae-43c9-8d98-d9a3a325a470",
      );
      expect(result.runtimeVersion).toEqual({ policy: "appVersion" });
    }
  });

  it("preserves unrelated fields from the base config untouched", () => {
    process.env.APP_VARIANT = "staging";
    const result = invoke();
    expect(result.version).toBe("1.1.1");
    expect(result.slug).toBe("persistence");
    expect(result.ios?.supportsTablet).toBe(true);
    expect(result.ios?.infoPlist).toEqual({
      ITSAppUsesNonExemptEncryption: false,
    });
    expect(result.android?.adaptiveIcon?.backgroundColor).toBe("#0C111A");
    expect(result.extra?.eas?.projectId).toBe(
      "255d542d-8dae-43c9-8d98-d9a3a325a470",
    );
  });

  it("omits Meta native config and declares no tracking when either value is absent", () => {
    process.env.EXPO_PUBLIC_META_APP_ID = "1502579917743484";
    delete process.env.EXPO_PUBLIC_META_CLIENT_TOKEN;
    const result = invoke();
    expect(result.extra?.metaConfigured).toBe(false);
    expect(result.plugins).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["react-native-fbsdk-next"]),
      ]),
    );
    expect(result.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
  });

  it("adds a disabled-by-default Meta plugin only when both verified values exist", () => {
    process.env.EXPO_PUBLIC_META_APP_ID = "verified-app-id";
    process.env.EXPO_PUBLIC_META_CLIENT_TOKEN = "verified-client-token";
    const result = invoke();
    expect(result.extra?.metaConfigured).toBe(true);
    expect(result.plugins).toEqual(
      expect.arrayContaining([
        [
          "react-native-fbsdk-next",
          expect.objectContaining({
            appID: "verified-app-id",
            clientToken: "verified-client-token",
            advertiserIDCollectionEnabled: false,
            autoLogAppEventsEnabled: false,
            isAutoInitEnabled: false,
          }),
        ],
      ]),
    );
    expect(result.ios?.privacyManifests?.NSPrivacyTracking).toBe(true);
    expect(result.ios?.privacyManifests?.NSPrivacyTrackingDomains).toEqual([
      "ep1.facebook.com",
    ]);
    expect(
      result.ios?.privacyManifests?.NSPrivacyCollectedDataTypes?.find(
        (entry) =>
          entry.NSPrivacyCollectedDataType ===
          "NSPrivacyCollectedDataTypeDeviceID",
      ),
    ).toEqual(
      expect.objectContaining({
        NSPrivacyCollectedDataTypeTracking: true,
        NSPrivacyCollectedDataTypePurposes: expect.arrayContaining([
          "NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising",
          "NSPrivacyCollectedDataTypePurposeAnalytics",
        ]),
      }),
    );
  });
});

describe("app.config.ts: Firebase google-services.json per variant (PER-149)", () => {
  const ENV_KEYS = [
    "APP_VARIANT",
    "GOOGLE_SERVICES_JSON",
    "EAS_BUILD_PLATFORM",
  ] as const;
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  let warn: jest.SpyInstance;
  let tmpDir: string;

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "per149-"));
  });

  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const always = () => true;

  it("maps each EAS variant to its committed file; play-testing shares production's", () => {
    expect(resolveGoogleServicesFile("staging", {}, always)).toEqual({
      file: "./firebase/google-services.staging.json",
    });
    expect(resolveGoogleServicesFile("production", {}, always)).toEqual({
      file: "./firebase/google-services.production.json",
    });
    expect(resolveGoogleServicesFile("play-testing", {}, always)).toEqual({
      file: "./firebase/google-services.production.json",
    });
  });

  it("the development variant has no Firebase app and expects no file", () => {
    expect(resolveGoogleServicesFile("development", {}, always)).toEqual({
      file: undefined,
    });
  });

  it("reports the missing committed file instead of pointing at it", () => {
    const result = resolveGoogleServicesFile("staging", {}, () => false);
    expect(result.file).toBeUndefined();
    expect(result.missing).toContain(
      "packages/mobile/firebase/google-services.staging.json",
    );
  });

  it("GOOGLE_SERVICES_JSON (EAS file env var) overrides the committed file", () => {
    const seen: string[] = [];
    const result = resolveGoogleServicesFile(
      "production",
      { GOOGLE_SERVICES_JSON: " /eas/tmp/google-services.json " },
      (file) => {
        seen.push(file);
        return true;
      },
    );
    expect(result).toEqual({ file: "/eas/tmp/google-services.json" });
    expect(seen).toEqual(["/eas/tmp/google-services.json"]);
  });

  it("reports a GOOGLE_SERVICES_JSON path that does not exist", () => {
    const result = resolveGoogleServicesFile(
      "staging",
      { GOOGLE_SERVICES_JSON: "/nope.json" },
      () => false,
    );
    expect(result.file).toBeUndefined();
    expect(result.missing).toContain("/nope.json");
  });

  it("sets android.googleServicesFile when the file exists", () => {
    const file = path.join(tmpDir, "google-services.json");
    fs.writeFileSync(file, "{}");
    process.env.APP_VARIANT = "staging";
    process.env.GOOGLE_SERVICES_JSON = file;
    const result = invoke();
    expect(result.android?.googleServicesFile).toBe(file);
    expect(result.android?.package).toBe(
      "com.bradleyevans96.persistence.staging",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves googleServicesFile out and warns when the file is missing (iOS, dev and tests keep working)", () => {
    process.env.APP_VARIANT = "staging";
    process.env.GOOGLE_SERVICES_JSON = path.join(tmpDir, "absent.json");
    const result = invoke();
    expect(result.android).not.toHaveProperty("googleServicesFile");
    expect(result.android?.adaptiveIcon?.backgroundColor).toBe("#0C111A");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("docs/android-push-setup.md"),
    );
  });

  it("fails an Android EAS build loudly when the file is missing", () => {
    process.env.APP_VARIANT = "production";
    process.env.GOOGLE_SERVICES_JSON = path.join(tmpDir, "absent.json");
    process.env.EAS_BUILD_PLATFORM = "android";
    expect(() => invoke()).toThrow(/Android push is off for this build/);
  });

  it("does not fail an iOS EAS build when the Android file is missing", () => {
    process.env.APP_VARIANT = "production";
    process.env.GOOGLE_SERVICES_JSON = path.join(tmpDir, "absent.json");
    process.env.EAS_BUILD_PLATFORM = "ios";
    expect(() => invoke()).not.toThrow();
  });

  it("an Android dev-variant EAS build needs no file", () => {
    process.env.APP_VARIANT = "development";
    process.env.EAS_BUILD_PLATFORM = "android";
    const result = invoke();
    expect(result.android).not.toHaveProperty("googleServicesFile");
    expect(warn).not.toHaveBeenCalled();
  });
});
