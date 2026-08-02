import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { GymsLockedPanel } from "@/ui/presenters/loadout/GymsLockedPanel";
import { SavedGymsContainer } from "@/ui/containers/SavedGymsContainer";
import { color } from "@/ui/theme/tokens";

/**
 * <GymsSegmentContainer> — the Train hub's `Gyms` segment (AC-7.2/7.2b).
 *
 * Owns the entitlement decision so `SavedGymsContainer` does not have to. There
 * are THREE body states here, not the two the gate's boolean suggests:
 *
 * 1. **pending** — `/subscriptions/me` still in flight. A spinner, never the
 *    upsell. ⚠ This is the guard `WorkoutDetailContainer` documents at its
 *    `onOpenLoadout`: `computeLoadoutVerdict` denies a null subscription by
 *    design (the alternative is flashing the surface as unlocked and then
 *    402-ing), so during the cold-start round trip a paying Premium+ user is
 *    indistinguishable from a free one. Rendering the pitch there sells the
 *    feature to the person who already bought it — on every cold launch, since
 *    this is a tab rather than a tap.
 * 2. **locked** — the pitch and a CTA. `SavedGymsContainer` is NOT mounted, and
 *    that is the enforcement rather than a nicety: `useSavedGyms` fetches on
 *    mount, so not mounting is what keeps an unentitled device from issuing
 *    `GET /saved-gyms` at all. Design § 5.2 forbids a preview of real output.
 * 3. **allowed** — the real list.
 *
 * An ERRORED subscription query counts as resolved (see `LoadoutGate.isResolved`),
 * so an offline user falls through to locked rather than spinning forever.
 */
export function GymsSegmentContainer() {
  const gate = useLoadoutGate();

  if (!gate.isResolved) {
    return (
      <View style={styles.pending} testID="gyms-segment-pending">
        <ActivityIndicator color={color.$text3} />
      </View>
    );
  }

  if (!gate.allowed) {
    return <GymsLockedPanel onUpgrade={gate.onUpgrade} />;
  }

  return <SavedGymsContainer />;
}

const styles = StyleSheet.create({
  pending: { flex: 1, alignItems: "center", justifyContent: "center" },
});
