/**
 * Prompt the OS for local-notification permission on first
 * authenticated app launch, then never again.
 *
 * Brad's note from the M3 Phase 3b staging review: the rest-timer
 * "ding" never fires on installed builds because nothing in V2 ever
 * called `requestPermissionsAsync()`. iOS only surfaces the system
 * permission prompt when an app explicitly asks; in its absence,
 * `scheduleNotificationAsync` silently no-ops for the entire app
 * lifetime. Calling it once on first authenticated home-screen
 * mount mirrors the legacy app's pattern
 * (`persistence-mobile/app/(tabs)/home.tsx:28-71`) and is the
 * minimum UX bar — Brad expected to see "Allow notifications?" on
 * install but the codepath simply didn't exist.
 *
 * Once-per-install semantics. The AsyncStorage flag mirrors legacy's
 * `NOTIFICATION_PERMISSION_KEY`: if the user has already been
 * asked (granted OR denied), we never re-prompt automatically. A
 * future Settings screen can offer a "request again" path that
 * clears this flag — out of scope here.
 *
 * Why a hook and not a side-effect inside `_layout.tsx`: the
 * permission prompt needs the user to be signed in (so we're not
 * pre-asking on the sign-in screen, which would feel pushy) AND
 * needs to read the current OS permission state, which is async.
 * A hook called from `HomeContainer` lands the prompt at the
 * earliest authenticated render, which is what legacy does.
 *
 * Why not in the StoragePort: this is a single boolean flag with
 * a one-shot lifetime per device install. Adding a port surface
 * for it would be overkill; AsyncStorage matches legacy 1:1 and
 * keeps the port focused on its caching responsibilities.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 *       Brad's M3 Phase 3b staging review (2026-05-14)
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
