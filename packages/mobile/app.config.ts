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
 * iOS App Privacy manifest (`PrivacyInfo.xcprivacy`). Expo generates the file
 * from this at prebuild — `ios/` is gitignored, so app.config.ts is the source
 * of truth. Audited against the codebase (see the Sentry/privacy PR):
 *
 *  - NSPrivacyTracking = false — the app does NO cross-app tracking (no ATT,
 *    no ad/attribution/analytics SDKs). Sentry/RevenueCat/Stripe/Supabase are
 *    the only data egress and none build a device/ad graph.
 *  - NSPrivacyCollectedDataTypes — every type is Linked to the authenticated
 *    Supabase user id and NOT used for tracking; purpose is App Functionality.
 *  - NSPrivacyAccessedAPITypes — required-reason APIs for app-owned usage
 *    (AsyncStorage→UserDefaults, expo-sqlite/updates/image file access). The
 *    bundled SDKs (Expo modules, Sentry, RevenueCat, Stripe) ship their own
 *    manifests, so this covers only app-level usage. Reason codes mirror what
 *    Expo prebuild already generates.
 */
const DATA_PURPOSE_APP_FUNCTIONALITY =
  "NSPrivacyCollectedDataTypePurposeAppFunctionality";

const collectedDataType = (type: string) => ({
  NSPrivacyCollectedDataType: type,
  // Linked to the authenticated user id; never used for cross-app tracking.
  NSPrivacyCollectedDataTypeLinked: true,
  NSPrivacyCollectedDataTypeTracking: false,
  NSPrivacyCollectedDataTypePurposes: [DATA_PURPOSE_APP_FUNCTIONALITY],
});

const IOS_PRIVACY_MANIFESTS = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [
    // Health & fitness — the core of the app.
    collectedDataType("NSPrivacyCollectedDataTypeHealth"), // HealthKit weight/body-fat, profile body metrics, measurements
    collectedDataType("NSPrivacyCollectedDataTypeFitness"), // workouts, sessions, sets/reps, nutrition/calories
    // Account / contact.
    collectedDataType("NSPrivacyCollectedDataTypeEmailAddress"), // email + Apple sign-in
    collectedDataType("NSPrivacyCollectedDataTypeName"), // profile full name / username / Apple full-name
    collectedDataType("NSPrivacyCollectedDataTypeUserID"), // Supabase user id (+ RevenueCat app user id)
    collectedDataType("NSPrivacyCollectedDataTypeDeviceID"), // Expo push token registered for notifications
    // User-generated content.
    collectedDataType("NSPrivacyCollectedDataTypePhotosorVideos"), // avatar, meal/recipe photos for AI logging
    collectedDataType("NSPrivacyCollectedDataTypeOtherUserContent"), // goal/session/coach notes, custom foods/recipes
    // Commerce.
    collectedDataType("NSPrivacyCollectedDataTypePurchaseHistory"), // RevenueCat/IAP subscription state
    // Diagnostics (Sentry).
    collectedDataType("NSPrivacyCollectedDataTypeCrashData"), // Sentry crash/error events (PII-scrubbed)
    collectedDataType("NSPrivacyCollectedDataTypePerformanceData"), // Sentry performance traces (PII-scrubbed)
  ],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
      NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
      NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
      NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
      NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
    },
  ],
};

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
  // Normalised environment label — feeds Sentry's `environment` tag via
  // `extra.appVariant` (read at runtime in src/lib/sentry.ts). Unknown/unset
  // APP_VARIANT collapses to "production" to match the variant fallback above.
  const environment: "production" | "staging" | "development" = isProduction
    ? "production"
    : (rawVariant as "staging" | "development");

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
    ios: {
      ...config.ios,
      bundleIdentifier: variant.bundleId,
      privacyManifests: IOS_PRIVACY_MANIFESTS,
    },
    android: { ...config.android, package: variant.bundleId },
    // EAS Update (OTA JS updates). Shared across all variants — the single EAS
    // project (`extra.eas.projectId`) serves them all; the per-profile
    // `channel` in eas.json routes each build to its own update branch
    // (staging/production). These live here because `eas update:configure`
    // can't auto-write a dynamic `app.config.ts`. `appVersion` runtime policy
    // ties an update's compatibility to the native app version.
    updates: {
      ...config.updates,
      url: "https://u.expo.dev/255d542d-8dae-43c9-8d98-d9a3a325a470",
    },
    runtimeVersion: { policy: "appVersion" },
    // Preserve app.json's `extra` (eas.projectId, router) and add the resolved
    // build variant so the runtime can tag Sentry's `environment` off it.
    extra: {
      ...config.extra,
      appVariant: environment,
    },
  };
};
