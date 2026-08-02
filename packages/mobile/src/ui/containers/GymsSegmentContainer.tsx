import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { GymsLockedPanel } from "@/ui/presenters/loadout/GymsLockedPanel";
import { SavedGymsContainer } from "@/ui/containers/SavedGymsContainer";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <GymsSegmentContainer> — the Train hub's `Gyms` segment (AC-7.2/7.2b).
 *
 * Owns the entitlement decision so `SavedGymsContainer` does not have to. There
 * are FOUR body states here, not the two the gate's boolean suggests:
 *
 * 1. **pending** — `/subscriptions/me` still in flight. A spinner, never the
 *    upsell. ⚠ This is the guard `WorkoutDetailContainer` documents at its
 *    `onOpenLoadout`: `computeLoadoutVerdict` denies a null subscription by
 *    design (the alternative is flashing the surface as unlocked and then
 *    402-ing), so during the cold-start round trip a paying Premium+ user is
 *    indistinguishable from a free one. Rendering the pitch there sells the
 *    feature to the person who already bought it — on every cold launch, since
 *    this is a tab rather than a tap.
 * 2. **stalled** — pending for longer than {@link RESOLVE_TIMEOUT_MS}. See below.
 * 3. **locked** — the pitch and a CTA. `SavedGymsContainer` is NOT mounted, and
 *    that is the enforcement rather than a nicety: `useSavedGyms` fetches on
 *    mount, so not mounting is what keeps an unentitled device from issuing
 *    `GET /saved-gyms` at all. Design § 5.2 forbids a preview of real output.
 * 4. **allowed** — the real list.
 *
 * ## ⚠ Why "resolved" is not enough on its own
 *
 * `isResolved` is `subscription !== null || isError`, so a REJECTED query resolves
 * and falls through to locked. But `getMySubscription` runs with no client-side
 * timeout, and a half-open socket (captive-portal Wi-Fi, dead NAT, a connection
 * dropped while backgrounded) never rejects at all — `fetch` simply never settles,
 * so React Query's retry never fires either. Unguarded, that spins this tab
 * forever with no copy and no way out, and because the segment PERSISTS, an
 * entitled user whose last segment was Gyms lands back on the frozen spinner on
 * every relaunch. Same failure class as the still-open profile-drawer
 * stuck-loading bug.
 *
 * The stalled state deliberately does NOT fall through to locked: showing the
 * paywall because the network hung would be the exact mistake state 1 exists to
 * prevent. It says what happened and offers a retry.
 *
 * ⚠ **The retry has to do BOTH halves or it is a lie.** Clearing `stalled` alone
 * neither reissues the request (`useLoadoutGate` owns the queries) nor re-arms the
 * clock — the timer effect keys on `gate.isResolved`, which has not changed — so
 * one tap returned the user to the unbounded spinner with no way back to the
 * retry screen. Hence `gate.refetch()` (which cancels the hung attempt) plus an
 * `attempt` counter in the effect's deps.
 */

/** Long enough not to fire on a slow-but-working cold start. */
const RESOLVE_TIMEOUT_MS = 8000;

export function GymsSegmentContainer() {
  const gate = useLoadoutGate();
  const [stalled, setStalled] = useState(false);
  /** Bumped by the retry so the timer effect re-runs while `isResolved` is unchanged. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (gate.isResolved) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [gate.isResolved, attempt]);

  const onRetry = useCallback(() => {
    setStalled(false);
    setAttempt((n) => n + 1);
    gate.refetch();
  }, [gate]);

  if (!gate.isResolved) {
    if (!stalled) {
      return (
        <View style={styles.centred} testID="gyms-segment-pending">
          <ActivityIndicator color={color.$text3} />
        </View>
      );
    }
    return (
      <View style={styles.centred} testID="gyms-segment-stalled">
        <Text style={styles.stalledText}>
          We couldn&apos;t check your subscription. Check your connection and
          try again.
        </Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={onRetry}
          testID="gyms-segment-retry"
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!gate.allowed) {
    return <GymsLockedPanel onUpgrade={gate.onUpgrade} />;
  }

  return <SavedGymsContainer />;
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.$lg,
    gap: space.$md,
  },
  stalledText: {
    fontSize: 13,
    color: color.$text3,
    lineHeight: 19,
    textAlign: "center",
  },
  retry: {
    height: 42,
    paddingHorizontal: space.$lg,
    borderRadius: radius.$lg,
    borderWidth: 1,
    borderColor: color.$border2,
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { fontSize: 13.5, fontWeight: "700", color: color.$text },
});
