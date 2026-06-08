/**
 * ActiveWorkoutOverlay — the single root-mounted "workout in progress" surface.
 *
 * Mounted once in `app/(app)/_layout.tsx` (sibling of the Stack + drawer).
 * Replaces the legacy `ActiveSessionBanner` with the prototype cyan-glow bar.
 *
 * ── Hybrid navigation model (Brad-confirmed 2026-06-07) ──────────────────────
 * Under Hybrid + Option A, the EXPANDED session stays the existing
 * `/(app)/session` MODAL ROUTE (port-faithful — legacy used a modal — and it
 * keeps Stream A's `router.push('/session?workoutId=')` start contract
 * untouched). This overlay therefore renders the minimised BAR ONLY; it does
 * NOT render `<ActiveSessionContainer>` (the route does). Visibility is driven
 * by the existence authority (SQLite via `useActiveSession`) gated on the
 * current route segment:
 *
 *   showBar = hasActiveSession && !onSessionScreen && !inAuth
 *
 * "Minimise" = the session screen's chevron dismisses the modal → the segment
 * no longer includes "session" → the bar reappears (no manually-synced flag to
 * desync, even on a swipe-to-dismiss gesture). "Expand" = tap the bar → push
 * the session route. Elapsed is wall-clock from `session.startedAt` (survives
 * backgrounding); a 1s interval re-renders the clock while visible.
 *
 * Spec: specs/05-active-session/design.md § <ActiveWorkoutBarPresenter> +
 *         § useActiveWorkout Zustand slice (Revised 2026-06-07)
 *       specs/05-active-session/requirements.md STORY-006
 */

import { router, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cancelSessionCommand } from "@/application/commands/session";
import {
  activeWorkoutElapsedSeconds,
  useActiveWorkout,
} from "@/state/active-workout";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  ActiveWorkoutBarPresenter,
  formatBarElapsed,
} from "@/ui/presenters/ActiveWorkoutBarPresenter";
import { EndConfirmDialogPresenter } from "@/ui/presenters/EndConfirmDialogPresenter";

// Tab-bar geometry contract — kept in lockstep with `14-navigation`'s
// `app/(app)/(tabs)/_layout.tsx` (`TAB_BAR_CONTENT_HEIGHT` 60 +
// `TAB_BAR_BOTTOM_GAP` 8) + `ACTIVE_WORKOUT_BAR_GAP` 12. Mirrored locally
// rather than imported so this presentation module doesn't pull the route
// tree (Tabs/navigator) into its graph — the same reason the legacy
// ActiveSessionBanner hardcoded `60 + insets.bottom`.
const TAB_BAR_CONTENT_HEIGHT = 60;
const TAB_BAR_BOTTOM_GAP = 8;
const ACTIVE_WORKOUT_BAR_GAP = 12;

export function ActiveWorkoutOverlay() {
  const { session, rereadCache } = useActiveSession();
  const { storage } = useAdapters();
  const insets = useSafeAreaInsets();
  const [endConfirmVisible, setEndConfirmVisible] = useState(false);

  // Expo Router types `useSegments` against the typed-route tuple, which
  // narrows literal `.includes()` of group segments to `never` — widen to
  // string[] for the runtime checks (mirrors the legacy banner).
  const segments = useSegments() as readonly string[];
  const onSessionScreen = segments.some((s) => s === "session");
  const inAuth = segments.includes("(auth)");
  const inTabs = segments.includes("(tabs)");

  const startedAt = session?.startedAt ?? null;
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? activeWorkoutElapsedSeconds(startedAt) : 0,
  );

  const visible = session != null && !onSessionScreen && !inAuth;

  // Tick the clock once a second while visible. Wall-clock derivation means a
  // missed tick (background) self-corrects on the next one.
  useEffect(() => {
    if (!visible || !startedAt) return;
    setElapsed(activeWorkoutElapsedSeconds(startedAt));
    const id = setInterval(
      () => setElapsed(activeWorkoutElapsedSeconds(startedAt)),
      1000,
    );
    return () => clearInterval(id);
  }, [visible, startedAt]);

  // Bug fix (Inspector Brad 🔴) — re-read SQLite on every route change.
  // `useActiveSession` snapshots through a `cacheVersion`-keyed `useMemo` and
  // never re-reads on navigation. Without this, the bar would never appear
  // after the normal start → minimise flow: the overlay mounts once (at
  // auth-resolve, session = null), the session is then written to SQLite by a
  // *different* `useActiveSession` instance inside `ActiveSessionContainer`,
  // and the overlay's memo — deps unchanged — keeps returning that mount-time
  // null. The legacy `ActiveSessionBanner` avoided this by re-reading storage
  // on every `segments` change; restore that. Keyed on the joined path string
  // so it fires once per route change, not on every render.
  const segmentsKey = segments.join("/");
  useEffect(() => {
    rereadCache();
  }, [segmentsKey, rereadCache]);

  if (!visible || !session) return null;

  const onPress = () => {
    router.push(`/(app)/session?sessionId=${session.id}` as never);
  };

  // STORY-006 AC 6.7 — long-press the bar opens the styled end-confirm dialog.
  const onLongPress = () => setEndConfirmVisible(true);

  const onConfirmEnd = () => {
    // Discard escape hatch — cancel queues the bulk-record cancellation flush;
    // end() clears the UI-state slice. `session.userId` is always present (the
    // session came from SQLite keyed on it), so no auth-userId guard is needed.
    setEndConfirmVisible(false);
    cancelSessionCommand({ storage, userId: session.userId });
    void useActiveWorkout.getState().end();
    // The bar's own end path triggers no navigation, so the cacheVersion-keyed
    // memo wouldn't otherwise refresh — re-read so the (now-cancelled) session
    // drops out and the bar hides immediately (Inspector Brad's secondary
    // symptom on the 🔴 lead).
    rereadCache();
  };

  // On a tab screen the bar floats above the tab bar; on a pushed-over screen
  // (no tab bar) it sits just above the home indicator. Same floating pill.
  const tabBarHeight =
    TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_BOTTOM_GAP;
  const bottom =
    (inTabs ? tabBarHeight : insets.bottom) + ACTIVE_WORKOUT_BAR_GAP;

  return (
    <>
      <View
        style={{ position: "absolute", left: 12, right: 12, bottom }}
        pointerEvents="box-none"
        testID="active-workout-overlay"
      >
        <ActiveWorkoutBarPresenter
          workoutName={session.name || "Active Workout"}
          elapsedSeconds={elapsed}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      </View>

      {endConfirmVisible && (
        <EndConfirmDialogPresenter
          elapsed={formatBarElapsed(elapsed)}
          onKeepGoing={() => setEndConfirmVisible(false)}
          onEnd={onConfirmEnd}
        />
      )}
    </>
  );
}
