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
 * The Train hub route — exported so notification dispatch sites can detect
 * a train-bound resolution and prime the Training-segment one-shot (M17
 * Send-brief lands the athlete on Train → Training even when a persisted
 * "Workouts"/"Exercises" segment would otherwise win). See
 * `ui/navigation/notificationRoute.ts`.
 */
export const TRAIN_ROUTE = "/(app)/(tabs)/train";

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
 * Custom-scheme deep links emitted by the backend (DB notification triggers +
 * handlers) look like `persistencemobile://<host>?<query>`. Map the known
 * hosts onto in-app routes. Unknown hosts fall back to Home so a tap never
 * dead-ends. Producers historically emitted these under `data.deeplink`
 * (lowercase) while the app reads `data.deepLink`; the adapters now tolerate
 * both, and this resolver normalises the scheme.
 */
const APP_SCHEME = "persistencemobile://";

const SCHEME_HOSTS: Record<string, string> = {
  requests: "/(app)/requests",
  clients: "/(app)/(tabs)/clients",
  profile: "/(app)/(tabs)/you",
  // M17 Send-brief — the coach_brief notification lands on the athlete
  // Training page (Train tab; the dispatch sites prime the Training segment).
  train: TRAIN_ROUTE,
};

function resolveSchemeLink(rest: string): string {
  const qIndex = rest.indexOf("?");
  const host = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const query = qIndex === -1 ? "" : rest.slice(qIndex); // includes the "?"
  const base = SCHEME_HOSTS[host];
  if (!base) return HOME_ROUTE;
  return query ? `${base}${query}` : base;
}

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
  if (trimmed.startsWith(APP_SCHEME)) {
    return resolveSchemeLink(trimmed.slice(APP_SCHEME.length));
  }
  if (LEGACY_REDIRECTS[trimmed]) return LEGACY_REDIRECTS[trimmed];
  // Already an absolute app path → pass through. Anything else is unknown.
  if (trimmed.startsWith("/")) return trimmed;
  return HOME_ROUTE;
}
