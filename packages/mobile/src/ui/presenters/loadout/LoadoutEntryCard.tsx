import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Pill } from "@/ui/components/foundation";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutEntryCard> — the "Adapt to your gym" affordance on workout detail
 * (T-2.2, design D7 step 1).
 *
 * Renders in both states from one card rather than hiding when locked: a user
 * who cannot see the feature cannot want it, and design § 5.2 makes the paywall
 * a **conversion surface** — there is no free taster to fall back on, so the
 * locked state is the only place the value proposition gets made.
 *
 * ⚠ **No price here.** The card says what the feature does and that it is
 * Premium+; the number lives in the upsell sheet, sourced from the catalog. A
 * literal on a card is exactly how the prototype's retired `£19.99` would have
 * shipped past a price change.
 */

export type LoadoutEntryCardProps = {
  /** From `useLoadoutGate`. Only meaningful once `pending` is false. */
  readonly locked: boolean;
  /**
   * The subscription hasn't resolved yet.
   *
   * ⚠ A third state, not a synonym for `locked`. The verdict denies a null
   * subscription on purpose, so during the cold-start `/subscriptions/me` round
   * trip a paying Premium+ user looks exactly like a free one — and showing them
   * a padlock for a feature they bought is worse than showing them nothing.
   */
  readonly pending?: boolean;
  /** A saved setup re-runs its root workout and replaces this variation. */
  readonly mode?: "adapt" | "readapt";
  /** False for ad-hoc setups and setups whose saved gym was deleted. */
  readonly linkedGymAvailable?: boolean;
  readonly gymUpdated?: boolean;
  readonly onPress: () => void;
};

export function LoadoutEntryCard({
  locked,
  pending = false,
  mode = "adapt",
  linkedGymAvailable = true,
  gymUpdated = false,
  onPress,
}: LoadoutEntryCardProps) {
  const isReadapt = mode === "readapt";
  const title = isReadapt ? "Re-adapt this setup" : "Adapt to your gym";
  const subtitle = pending
    ? isReadapt
      ? "Preparing your saved setup"
      : "Re-map this workout to whatever kit you have today"
    : gymUpdated
      ? "Your gym equipment has changed since this setup was made"
      : isReadapt
        ? linkedGymAvailable
          ? "Re-run the original workout against your gym's current equipment"
          : "Choose equipment and re-run the original workout"
        : locked
          ? "Unlock to re-map this workout to whatever kit you have"
          : "Re-map this workout to whatever kit you have today";

  return (
    <TouchableOpacity
      style={[styles.card, pending && styles.cardPending]}
      onPress={onPress}
      disabled={pending}
      testID="loadout-entry-card"
      accessibilityRole="button"
      accessibilityState={{ disabled: pending }}
      accessibilityLabel={
        locked ? `${title}. Premium Plus feature, locked.` : title
      }
    >
      <View style={styles.icon}>
        <Ionicons
          name={pending ? "sparkles" : locked ? "lock-closed" : "sparkles"}
          size={19}
          color={color.$primary}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          <Pill tone="primary" size="xs">
            PREMIUM+
          </Pill>
        </View>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={color.$primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$base,
    borderRadius: radius.$xl,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$primaryDim,
  },
  cardPending: { opacity: 0.6 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.$md,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.$sm },
  title: { fontSize: 15, fontWeight: "700", color: color.$text },
  subtitle: { fontSize: 12, color: color.$text3, lineHeight: 17 },
});
