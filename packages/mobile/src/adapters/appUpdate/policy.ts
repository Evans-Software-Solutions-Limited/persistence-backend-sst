/** Minimum binary that includes the release Together native modules. */
export const BUNDLED_MINIMUM_VERSION = "1.1.3";
export type AppVersionPolicy = {
  iosMinimumVersion: string;
  androidMinimumVersion: string;
};
const version = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
export function isVersion(value: unknown): value is string {
  return typeof value === "string" && version.test(value);
}
export function olderThan(installed: string, minimum: string) {
  const a = installed.split(".").map(Number),
    b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
export function parsePolicy(value: unknown): AppVersionPolicy | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return isVersion(p.iosMinimumVersion) && isVersion(p.androidMinimumVersion)
    ? {
        iosMinimumVersion: p.iosMinimumVersion,
        androidMinimumVersion: p.androidMinimumVersion,
      }
    : null;
}
export function requiredVersion(
  policy: AppVersionPolicy | null,
  platform: "ios" | "android",
) {
  const remote =
    platform === "ios"
      ? policy?.iosMinimumVersion
      : policy?.androidMinimumVersion;
  return remote && olderThan(BUNDLED_MINIMUM_VERSION, remote)
    ? remote
    : BUNDLED_MINIMUM_VERSION;
}
export function updateRequired(
  installed: unknown,
  minimum: string,
  nativeReady: boolean,
) {
  return !nativeReady || !isVersion(installed) || olderThan(installed, minimum);
}
export function storeUrl(
  platform: "ios" | "android",
  applicationId: string | null,
): string | null {
  if (applicationId !== "com.bradleyevans96.persistence") return null;
  return platform === "ios"
    ? "https://apps.apple.com/app/id6755091280"
    : "https://play.google.com/store/apps/details?id=com.bradleyevans96.persistence";
}
