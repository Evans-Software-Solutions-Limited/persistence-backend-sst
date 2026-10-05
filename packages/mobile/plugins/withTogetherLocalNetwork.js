const { AndroidConfig } = require("@expo/config-plugins");

// The owner build pins its SDK in expo-build-properties. Do not declare the
// Android 17 permission on the current target-36 binary (including API-37 devices).
module.exports = function withTogetherLocalNetwork(config) {
  const buildProperties = config.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
  );
  const target = buildProperties?.[1]?.android?.targetSdkVersion;
  if (typeof target === "number" && target >= 37) {
    return AndroidConfig.Permissions.withPermissions(config, [
      "android.permission.ACCESS_LOCAL_NETWORK",
    ]);
  }
  return config;
};
