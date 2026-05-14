/**
 * Prompt the OS for local-notification permission as soon as the
 * app loads, then never again. Mounted from `app/_layout.tsx` via
 * `NotificationPermissionsBootstrap` so it fires regardless of
 * whether the user is signed in.
 *
 * Brad's note from the M3 Phase 3b staging review: the rest-timer
 * "ding" never fires on installed builds because nothing in V2 ever
 * called `requestPermissionsAsync()`. iOS only surfaces the system
 * permission prompt when an app explicitly asks; in its absence,
 * `scheduleNotificationAsync` silently no-ops for the entire app
 * lifetime. Brad's follow-up after the first fix landed the prompt
 * post-auth: "The notification permissions should be requested by
 * the user on load of the application." Calling the hook from the
 * root layout (NotificationPermissionsBootstrap sibling of
 * AuthGate) lands the prompt before any screen renders.
 *
 * Once-per-install semantics. The AsyncStorage flag mirrors legacy's
 * `NOTIFICATION_PERMISSION_KEY`: if the user has already been
 * asked (granted OR denied), we never re-prompt automatically. A
 * future Settings screen can offer a "request again" path that
 * clears this flag — out of scope here.
 *
 * Why a hook (and not a module-load side effect): we need an active
 * `useAdapters` reference for the abstraction-friendly
 * `notifications.requestPermissions()` call, and we need a React
 * lifecycle to attach a cleanup. The `enabled` parameter is kept
 * for two reasons: (a) Settings can someday pass `false` to disable
 * the auto-prompt, (b) tests can opt out without rendering a full
 * provider tree.
 *
 * Why not in the StoragePort: this is a single boolean flag with
 * a one-shot lifetime per device install. Adding a port surface
 * for it would be overkill; AsyncStorage matches legacy 1:1 and
 * keeps the port focused on its caching responsibilities.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 *       Brad's M3 Phase 3b staging review (2026-05-14)
 *       Brad's PR #64 review follow-up — prompt-on-app-load
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { useAdapters } from "./useAdapters";

const PERMISSION_REQUESTED_KEY = "notification_permission_requested";

/**
 * Fires the permission prompt once per device install, on first
 * authenticated render. No-op when `enabled` is false (e.g. before
 * auth has settled, or when the caller deliberately wants to defer
 * until the user starts their first session).
 *
 * Safe to call from multiple render passes — the `requestedRef`
 * guard plus the AsyncStorage flag mean the underlying
 * `requestPermissions()` adapter call happens at most once per
 * launch (ref) and at most once per install (storage).
 */
export function useNotificationPermissions(enabled: boolean): void {
  const { notifications } = useAdapters();
  // In-memory dedupe within a single launch — handles the case where
  // multiple HomeContainer remounts fire the effect before
  // AsyncStorage has finished its first write.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (requestedRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const alreadyRequested = await AsyncStorage.getItem(
          PERMISSION_REQUESTED_KEY,
        );
        if (cancelled) return;
        if (alreadyRequested === "true") {
          requestedRef.current = true;
          return;
        }

        // Read current OS status before prompting — if the user has
        // already granted (e.g. via Settings before we ever asked),
        // we just stamp the flag and move on without re-showing a
        // banner.
        const status = await notifications.getPermissionStatus();
        if (cancelled) return;
        if (status === "granted") {
          requestedRef.current = true;
          await AsyncStorage.setItem(PERMISSION_REQUESTED_KEY, "true");
          return;
        }

        if (status === "denied") {
          // User has actively denied — don't re-prompt automatically.
          // Future Settings → "Enable notifications" can clear the
          // flag if they change their mind.
          requestedRef.current = true;
          await AsyncStorage.setItem(PERMISSION_REQUESTED_KEY, "true");
          return;
        }

        // status === "not_determined" — actually fire the prompt.
        // Mark the ref BEFORE awaiting so a concurrent re-render
        // doesn't double-prompt during the system-modal animation.
        requestedRef.current = true;
        await notifications.requestPermissions();
        if (cancelled) return;
        await AsyncStorage.setItem(PERMISSION_REQUESTED_KEY, "true");
      } catch {
        // AsyncStorage failure or adapter throw — silent. The rest
        // timer's catch-and-fall-back path means the user still
        // gets the in-app countdown even if the prompt never fired.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, notifications]);
}
