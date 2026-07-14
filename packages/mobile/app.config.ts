import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Per-variant overrides layered on top of `app.json`. Selecting a variant
 * lets staging/dev builds install side-by-side with production as distinct
 * apps (separate bundle id + custom scheme + isolated sandboxes), driven by
 * `APP_VARIANT` in each `eas.json` build profile's `env` block.
 *
 * All variants share the one EAS project (`slug` stays unchanged — see
 * below) so a single `extra.eas.projectId` in `app.json` covers all of them.
 */
const VARIANTS = {
  production: {
    bundleId: "com.bradleyevans96.persistence",
    name: "Persistence",
    scheme: "persistencemobile",
  },
  staging: {
    bundleId: "com.bradleyevans96.persistence.staging",
    name: "Persistence (Staging)",
    scheme: "persistencemobile-staging",
  },
  development: {
    bundleId: "com.bradleyevans96.persistence.dev",
    name: "Persistence (Dev)",
    scheme: "persistencemobile-dev",
  },
} as const;

/**
 * Expo dynamic config. Expo loads `app.json` first and hands its `expo`
 * object in as `config`, so spreading `...config` and overriding ONLY the
 * per-variant fields below preserves everything else untouched — infoPlist,
 * entitlements, plugins, extra/eas projectId, version, icons, etc.
 *
 * `APP_VARIANT` unset (local dev outside EAS, e.g. `expo start`) or unknown
 * falls back to `production` so the default experience is unchanged.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const rawVariant = process.env.APP_VARIANT ?? "production";
  const isProduction = !(rawVariant in VARIANTS) || rawVariant === "production";
  const variant = isProduction
    ? VARIANTS.production
    : VARIANTS[rawVariant as keyof typeof VARIANTS];

  return {
    ...config,
    // Production keeps app.json's existing display name byte-identical — this
    // PR must not change the shipped prod label as a side-effect. Only the
    // staging/dev variants get a distinct "(Staging)"/"(Dev)" name. (Renaming
    // prod, if wanted, is a deliberate separate change to app.json's `name`.)
    name: isProduction ? (config.name ?? variant.name) : variant.name,
    // Shared across all variants — every variant builds under the one EAS
    // project.
    slug: config.slug ?? "persistence",
    scheme: variant.scheme,
    ios: { ...config.ios, bundleIdentifier: variant.bundleId },
    android: { ...config.android, package: variant.bundleId },
  };
};
