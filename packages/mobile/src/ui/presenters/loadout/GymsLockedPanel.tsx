import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <GymsLockedPanel> — what the Train hub's `Gyms` segment shows to a user who
 * is not entitled to Loadout (AC-7.2b).
 *
 * ⚠ **Locked is NOT a taster.** Design § 5.2 is a hard gate: no free-tier code
 * path, no preview of real output. So this is a pitch and a CTA and nothing
 * else — no list, no empty state, no counts, no create button, and no gym data
 * behind it (`GymsSegmentContainer` does not mount `SavedGymsContainer`, so an
 * unentitled device never issues `GET /saved-gyms`). "Show the list greyed out"
 * would read better as an advert and is precisely what § 5.2 forbids.
 *
 * ⚠ **No price literal.** Same rule as `LoadoutEntryCard`: the number lives in
 * the upsell sheet, sourced from the live tier API. A hardcoded number is how a
 * retired figure survives a price change.
 */

export type GymsLockedPanelProps = {
  readonly onUpgrade: () => void;
};

export function GymsLockedPanel({ onUpgrade }: GymsLockedPanelProps) {
  return (
    <View style={styles.root} testID="gyms-locked">
      <View style={styles.icon}>
        <Ionicons name="location-outline" size={22} color={color.$primary} />
      </View>

      <Text style={styles.title}>Save the gyms you train at</Text>
      <Text style={styles.blurb}>
        Set up the kit at your gym, the hotel, your garage — then Loadout
        re-maps any workout to whichever one you&apos;re standing in, keeping
        the same targets.
      </Text>

      <View style={styles.pill}>
        <Text style={styles.pillText}>PREMIUM+</Text>
      </View>

      <TouchableOpacity
        style={styles.cta}
        onPress={onUpgrade}
        testID="gyms-locked-upgrade"
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>See Premium+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    margin: space.$base,
    padding: space.$lg,
    borderRadius: radius.$xl,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    alignItems: "center",
    gap: space.$sm,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.$md,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  blurb: {
    fontSize: 13,
    color: color.$text3,
    lineHeight: 19,
    textAlign: "center",
  },
  pill: {
    paddingHorizontal: space.$sm,
    paddingVertical: 3,
    borderRadius: radius.$pill,
    backgroundColor: color.$primaryDim,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: color.$primary,
  },
  cta: {
    alignSelf: "stretch",
    height: 46,
    marginTop: space.$xs,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 14.5, fontWeight: "700", color: color.$primaryInk },
});
