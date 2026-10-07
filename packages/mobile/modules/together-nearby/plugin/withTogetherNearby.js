const { createHash } = require("node:crypto");
const { withInfoPlist } = require("@expo/config-plugins");

const withTogetherLocalNetwork = require("../../../plugins/withTogetherLocalNetwork");

module.exports = function withTogetherNearby(config) {
  config = withTogetherLocalNetwork(config);
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSBluetoothAlwaysUsageDescription ??=
      "Discover and connect to nearby Together training partners, including without internet.";
    mod.modResults.NSLocalNetworkUsageDescription ??=
      "Connect to Together training partners on your local network without internet.";
    const hash = createHash("sha256")
      .update("uk.persistence.together.v1")
      .digest("hex")
      .slice(0, 12);
    mod.modResults.NSBonjourServices = [
      ...new Set([
        ...(mod.modResults.NSBonjourServices ?? []),
        `_${hash}._tcp`,
      ]),
    ];
    return mod;
  });
  return config;
};
