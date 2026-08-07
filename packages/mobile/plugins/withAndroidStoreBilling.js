const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

/**
 * RevenueCat requires standard/singleTop so a Google Play purchase can leave
 * the app for bank verification and resume without the billing flow being
 * cancelled. Expo Router generates singleTask by default, so keep this as a
 * source-controlled CNG override rather than editing generated Android files.
 */
module.exports = function withAndroidStoreBilling(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      manifestConfig.modResults,
    );
    mainActivity.$["android:launchMode"] = "singleTop";
    return manifestConfig;
  });
};
