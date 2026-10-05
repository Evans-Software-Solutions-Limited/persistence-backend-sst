const { createHash } = require("node:crypto");
const { withInfoPlist, withPodfile } = require("@expo/config-plugins");

const marker = "# persistence-together-nearby";
function patchPodfile(contents) {
  if (contents.includes(marker)) return contents;
  const hook = /post_install do \|installer\|/g;
  if ([...contents.matchAll(hook)].length !== 1) {
    throw new Error(
      "Together Nearby requires exactly one CocoaPods post_install hook",
    );
  }
  return contents.replace(
    hook,
    (line) =>
      `${line}\n    ${marker}\n    require_relative '../modules/together-nearby/plugin/link_nearby'\n    PersistenceTogetherNearby.install(installer)`,
  );
}
module.exports = function withTogetherNearby(config) {
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
  return withPodfile(config, (mod) => {
    mod.modResults.contents = patchPodfile(mod.modResults.contents);
    return mod;
  });
};
module.exports.patchPodfile = patchPodfile;
