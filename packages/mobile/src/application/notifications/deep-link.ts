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
  // Coach Mode Phase 8 (invite/QR) — a scanned/shared invite-code link
  // (`persistencemobile://accept-invite?code=X`) lands on the athlete
  // redeem screen, which reads `code` off the preserved query string.
  "accept-invite": "/(app)/accept-invite",
};

/**
 * Split a scheme "rest" (everything after `persistencemobile://`, or a bare
 * OS path with any single leading slash removed) into its first segment
 * (`host`) and the query string (including the leading `?`, or ""). Shared by
 * the notification resolver and the OS-linking redirect so both map hosts the
 * same way.
 */
function splitHostAndQuery(rest: string): { host: string; query: string } {
  const qIndex = rest.indexOf("?");
  return qIndex === -1
    ? { host: rest, query: "" }
    : { host: rest.slice(0, qIndex), query: rest.slice(qIndex) };
}

function resolveSchemeLink(rest: string): string {
  const { host, query } = splitHostAndQuery(rest);
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

/**
 * Rewrite an OS-level deep-link path onto an in-app route — the body of Expo
 * Router's `app/+native-intent.ts` `redirectSystemPath`.
 *
 * A QR scan or a shared invite link opens through the native `Linking`
 * pipeline, NOT the push-notification tap resolver, so a custom-scheme host
 * link (`persistencemobile://accept-invite?code=X`) would otherwise reach the
 * router as a bare `accept-invite?code=X` segment and dead-end on the
 * Unmatched route. Reusing the same `SCHEME_HOSTS` table keeps both entry
 * points in sync.
 *
 * Handles all three shapes Expo can hand us: a full custom-scheme URL, the
 * `Linking.createURL` canonical form (leading-slash path), and the legacy
 * host-form (no leading slash). Unlike `resolveNotificationRoute`, an
 * unrecognised path is returned UNCHANGED so Expo Router can still match it
 * normally — we only claim the known custom-scheme hosts.
 */
export function redirectSystemPathForDeepLink(
  path: string | null | undefined,
): string {
  if (!path) return HOME_ROUTE;
  // Strip the custom scheme if the OS handed us a full URL, then drop a single
  // leading slash so the first path segment lines up with the scheme-host keys.
  const stripped = path.startsWith(APP_SCHEME)
    ? path.slice(APP_SCHEME.length)
    : path;
  const candidate = stripped.startsWith("/") ? stripped.slice(1) : stripped;
  const { host, query } = splitHostAndQuery(candidate);
  const base = SCHEME_HOSTS[host];
  if (!base) return path;
  return query ? `${base}${query}` : base;
}
