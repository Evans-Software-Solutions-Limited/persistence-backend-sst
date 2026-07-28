import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutSavedStep> — the success screen (T-2.8, design D7 step 7).
 *
 * ⚠ **The line about the original is the point of this screen, not filler.**
 * The user has just watched most of their workout change, and AC-5.1's whole
 * promise is that the workout they built is untouched. Saying so here is the only
 * place that promise is ever made visible; without it a first-time user has to
 * navigate back and check.
 *
 * No back affordance: the flow is finished and there is nothing behind it worth
 * returning to. The single CTA dismisses the route onto the workout detail, whose
 * "Saved setups" list has already re-read via the store's `rev` bump.
 *
 * ⚠ Insets via `useSafeAreaInsets()` rather than `<SafeAreaView>`, for the reason
 * `LoadoutScaffold` documents at length: that component is native-only, never
 * reads the context, and measured ZERO inside this `fullScreenModal` route. This
 * step does not use the scaffold (no header, no scroll), so it has to repeat the
 * idiom rather than inherit it.
 */

export type LoadoutSavedStepProps = {
  readonly workoutName: string;
  readonly gymLabel: string;
  readonly onDone: () => void;
};

export function LoadoutSavedStep({
  workoutName,
  gymLabel,
  onDone,
}: LoadoutSavedStepProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      testID="loadout-saved"
    >
      <View style={styles.body}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={36} color={color.$primaryInk} />
        </View>
        <Text style={styles.title}>Variation saved</Text>
        <Text style={styles.blurb}>
          <Text style={styles.blurbStrong}>
            {workoutName} · {gymLabel}
          </Text>{" "}
          is saved under your workout. Your original stays exactly as it was.
        </Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={onDone}
          testID="loadout-saved-done"
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>View saved setups</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.$bg },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.$2xl,
    gap: space.$base,
  },
  badge: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: color.$text,
    textAlign: "center",
  },
  blurb: {
    fontSize: 14,
    color: color.$text2,
    lineHeight: 21,
    textAlign: "center",
  },
  blurbStrong: { color: color.$text, fontWeight: "700" },
  cta: {
    alignSelf: "stretch",
    height: 52,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.$md,
  },
  ctaText: { fontSize: 15, fontWeight: "700", color: color.$primaryInk },
});
