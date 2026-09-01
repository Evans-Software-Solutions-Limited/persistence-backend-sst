/** Build-time/OTA rollout gate for Spec 31 experience polish slices. */
export function isExperiencePolishEnabled(
  value = process.env.EXPO_PUBLIC_EXPERIENCE_POLISH_V1_ENABLED,
): boolean {
  // Safe-off: a missing or malformed deployment value never enables rollout.
  return value === "true";
}
