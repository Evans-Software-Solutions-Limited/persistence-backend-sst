const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

/**
 * PER-137 (native change approved by Brad, 26 Nov 2026): keep Android's
 * main activity portrait in the manifest.
 *
 * `app.json` sets `orientation: "default"` so iOS lists landscape in its
 * Info.plist (iOS can only turn to orientations the plist allows). On
 * Android that same key writes `android:screenOrientation="unspecified"`,
 * so the app could rotate on a cold start until JS locks it to portrait.
 * Android doesn't need it: `expo-screen-orientation`'s `lockAsync` calls
 * `Activity.setRequestedOrientation`, which overrides the manifest at run
 * time, so the progress photo viewer can still turn landscape.
 *
 * Expo's own orientation mod is registered after user plugins and so runs
 * first; this one runs after it and has the final say.
 */
function setPortraitActivity(androidManifest) {
  const mainActivity =
    AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  mainActivity.$["android:screenOrientation"] = "portrait";
  return androidManifest;
}

function withAndroidPortraitActivity(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = setPortraitActivity(manifestConfig.modResults);
    return manifestConfig;
  });
}

module.exports = Object.assign(withAndroidPortraitActivity, {
  setPortraitActivity,
});
