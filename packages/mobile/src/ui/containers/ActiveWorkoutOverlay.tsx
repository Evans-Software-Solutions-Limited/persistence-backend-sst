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
import { Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cancelSessionCommand } from "@/application/commands/session";
import {
  activeWorkoutElapsedSeconds,
  useActiveWorkout,
} from "@/state/active-workout";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { ActiveWorkoutBarPresenter } from "@/ui/presenters/ActiveWorkoutBarPresenter";

// Tab-bar geometry contract — kept in lockstep with `14-navigation`'s
// `app/(app)/(tabs)/_layout.tsx` (`TAB_BAR_CONTENT_HEIGHT` 60 +
// `TAB_BAR_BOTTOM_GAP` 8) + `ACTIVE_WORKOUT_BAR_GAP` 12. Mirrored locally
// rather than imported so this presentation module doesn't pull the route
// tree (Tabs/navigator) into its graph — the same reason the legacy
// ActiveSessionBanner hardcoded `60 + insets.bottom`.
const TAB_BAR_CONTENT_HEIGHT = 60;
const TAB_BAR_BOTTOM_GAP = 8;
const ACTIVE_WORKOUT_BAR_GAP = 12;

export type ActiveWorkoutOverlayProps = {
  /**
   * Test seam — replaces the imperative end confirmation. Production uses an
   * Alert; Phase 05.4 swaps this for the styled <EndConfirmDialogPresenter>.
   */
  confirmEnd?: (onConfirm: () => void) => void;
};

function defaultConfirmEnd(onConfirm: () => void): void {
  Alert.alert(
    "End workout?",
    "Your progress so far won't be saved as a completed workout.",
    [
      { text: "Keep going", style: "cancel" },
      { text: "End", style: "destructive", onPress: onConfirm },
    ],
  );
}

export function ActiveWorkoutOverlay({
  confirmEnd = defaultConfirmEnd,
}: ActiveWorkoutOverlayProps = {}) {
  const { session } = useActiveSession();
  const { storage } = useAdapters();
  const insets = useSafeAreaInsets();

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

  if (!visible || !session) return null;

  const onPress = () => {
    router.push(`/(app)/session?sessionId=${session.id}` as never);
  };

  const onLongPress = () => {
    confirmEnd(() => {
      // Discard escape hatch (STORY-006 AC 6.7) — cancel queues the
      // bulk-record cancellation flush; end() clears the UI-state slice.
      // `session.userId` is always present (the session came from SQLite
      // keyed on it), so no auth-userId guard is needed.
      cancelSessionCommand({ storage, userId: session.userId });
      void useActiveWorkout.getState().end();
    });
  };

  // On a tab screen the bar floats above the tab bar; on a pushed-over screen
  // (no tab bar) it sits just above the home indicator. Same floating pill.
  const tabBarHeight =
    TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_BOTTOM_GAP;
  const bottom =
    (inTabs ? tabBarHeight : insets.bottom) + ACTIVE_WORKOUT_BAR_GAP;

  return (
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
  );
}
