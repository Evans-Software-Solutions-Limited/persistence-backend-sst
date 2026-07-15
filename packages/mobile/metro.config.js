const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// `getSentryExpoConfig` wraps Expo's default Metro config to emit the
// Debug IDs Sentry needs to match uploaded source maps to stack traces. It's
// a drop-in for `getDefaultConfig` and no-ops for symbolication when Sentry
// isn't configured, so it's safe regardless of whether a DSN is set.
const config = getSentryExpoConfig(projectRoot);

// Watch the monorepo root for shared packages
config.watchFolders = [monorepoRoot];

// Resolve packages from both the mobile package and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
