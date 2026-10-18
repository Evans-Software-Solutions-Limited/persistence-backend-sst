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
    // Nearby browses Bonjour for `_<HEX>._tcp.`: the first 6 bytes of
    // SHA-256(serviceID) printed with "%02X" (connections/implementation/
    // mediums/wifi_lan.cc GenerateServiceType, NsdServiceInfo::kNsdTypeFormat).
    // NSBonjourServices must carry the same spelling or iOS 14+ denies the
    // Wi-Fi LAN medium and every connection is forced over BLE alone.
    const hash = createHash("sha256")
      .update("uk.persistence.together.v1")
      .digest("hex")
      .slice(0, 12)
      .toUpperCase();
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
