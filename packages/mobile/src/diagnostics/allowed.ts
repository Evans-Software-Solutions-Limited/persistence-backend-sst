import Constants from "expo-constants";

/**
 * Hidden diagnostic screens (the Together crypto probe, the request log) are
 * reachable on development builds and on non-production variants only.
 * Production builds redirect them to Home.
 */
export function isDiagnosticsAllowed(
  variant: unknown = Constants.expoConfig?.extra?.appVariant,
  devBuild: boolean = __DEV__,
): boolean {
  return devBuild || (typeof variant === "string" && variant !== "production");
}
