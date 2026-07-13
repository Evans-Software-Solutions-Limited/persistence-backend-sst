import { redirectSystemPathForDeepLink } from "@/application/notifications/deep-link";

/**
 * Expo Router OS-level deep-link hook (auto-discovered at the app root).
 *
 * A QR scan or a shared invite link enters through the native `Linking`
 * pipeline — NOT the push-notification tap resolver — so this is where a
 * `persistencemobile://accept-invite?code=X` link (or its `Linking.createURL`
 * canonical form) is rewritten onto the in-app `/(app)/accept-invite` route
 * before Expo Router matches it. Without this the custom-scheme host link
 * dead-ends on the Unmatched route.
 *
 * The mapping lives in `application/notifications/deep-link.ts` so it stays in
 * sync with the notification-tap resolver (both share `SCHEME_HOSTS`).
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  return redirectSystemPathForDeepLink(path);
}
