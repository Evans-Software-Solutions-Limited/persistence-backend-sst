import type { ConfigContext, ExpoConfig } from "expo/config";

import getConfig from "../app.config";

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

  afterEach(() => {
    if (originalVariant === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = originalVariant;
    }
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
});
