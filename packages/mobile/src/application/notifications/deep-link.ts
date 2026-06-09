/**
 * Notification deep-link route resolver.
 *
 * Maps a notification's `data.deepLink` onto a concrete app route. There
 * is no central `14-navigation` redirect map in the codebase, so this is
 * the (small, self-contained) redirect table for notification taps:
 *   - legacy paths are remapped to their current routes,
 *   - already-valid absolute paths pass through,
 *   - empty / unknown links fall back to Home (AC 5.5).
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-005
 *       design.md § Push notification listener
 */

export const HOME_ROUTE = "/(app)/(tabs)";

/**
 * Legacy → current path remaps. Extend additively as new producers emit
 * deep links. Keys are the raw `data.deepLink` values; values are valid
 * Expo Router paths.
 */
const LEGACY_REDIRECTS: Record<string, string> = {
  "/progress": "/(app)/(tabs)/you",
  "/notifications": "/(app)/notifications",
  "/profile/notifications": "/(app)/profile/notifications",
};

/**
 * Resolve a deep link to a route. Returns Home for null/empty/unknown so
 * a tap always lands somewhere valid (never a dead route).
 */
export function resolveNotificationRoute(
  deepLink: string | null | undefined,
): string {
  if (!deepLink) return HOME_ROUTE;
  const trimmed = deepLink.trim();
  if (trimmed === "") return HOME_ROUTE;
  if (LEGACY_REDIRECTS[trimmed]) return LEGACY_REDIRECTS[trimmed];
  // Already an absolute app path → pass through. Anything else is unknown.
  if (trimmed.startsWith("/")) return trimmed;
  return HOME_ROUTE;
}
