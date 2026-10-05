const { withInfoPlist, AndroidConfig } = require("@expo/config-plugins");

const withTogetherLocalNetwork = require("./withTogetherLocalNetwork");

module.exports = function withTogetherLan(config) {
  config = withTogetherLocalNetwork(config);
  config = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
  ]);
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSLocalNetworkUsageDescription ??=
      "Find and connect to your Together training lobby on the same Wi-Fi or hotspot, even without internet.";
    mod.modResults.NSBonjourServices = [
      ...new Set([
        ...(mod.modResults.NSBonjourServices ?? []),
        "_persist-tg._tcp",
      ]),
    ];
    return mod;
  });
};
