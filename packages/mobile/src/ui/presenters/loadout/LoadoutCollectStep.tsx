import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { SavedGym } from "@/domain/models/loadout";
import { itemLabel } from "@/shared/utils";
import { Pill } from "@/ui/components/foundation";
import { LoadoutScaffold } from "./LoadoutScaffold";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutCollectStep> — "What have you got today?" (T-2.3, AC-2.1/2.2/2.3,
 * design D7 step 2).
 *
 * Three ways in, and the ORDER is the design's claim about which is fastest, not
 * a ranking of which is trustworthy:
 *
 *   - **Scan** — one photo. Badged FASTEST, and hidden entirely when the scan is
 *     unavailable (see `scanAvailable`).
 *   - **Pick equipment** — the checklist.
 *   - **Reuse a saved gym** — below a divider, because it only exists once the
 *     user has been here before.
 *
 * ⚠ **The picker and saved gyms are the FLOOR, not fallbacks** (design § 1b).
 * E1's 0.966 scan recall was measured on mostly-stock photos and is a ceiling
 * rather than a real-world rate, so Loadout has to be complete without the scan.
 * That is why `scanAvailable` can drop the scan option and leave a coherent
 * screen rather than a broken one — and why the scan is not the default.
 */

export type LoadoutCollectStepProps = {
  readonly workoutName: string;
  /** False hides the scan entirely (kill switch / offline). */
  readonly scanAvailable: boolean;
  readonly savedGyms: readonly SavedGym[];
  readonly isLoadingGyms: boolean;
  readonly onBack: () => void;
  readonly onScan: () => void;
  readonly onManual: () => void;
  readonly onUseGym: (gym: SavedGym) => void;
};

export function LoadoutCollectStep({
  workoutName,
  scanAvailable,
  savedGyms,
  isLoadingGyms,
  onBack,
  onScan,
  onManual,
  onUseGym,
}: LoadoutCollectStepProps) {
  return (
    <LoadoutScaffold
      title="Set up Loadout"
      eyebrow="LOADOUT"
      onBack={onBack}
      backIcon="close"
      backLabel="Close Loadout"
      testID="loadout-collect"
    >
      <View style={styles.intro}>
        <Text style={styles.heading}>What have you got today?</Text>
        <Text style={styles.blurb}>
          Tell Loadout what&apos;s available and it re-maps{" "}
          <Text style={styles.blurbStrong}>{workoutName}</Text> to fit — same
          targets, matched movements.
        </Text>
      </View>

      {scanAvailable ? (
        <SourceOption
          icon="camera-outline"
          title="Scan the gym"
          subtitle="Point your camera — Loadout reads the kit"
          badge="FASTEST"
          onPress={onScan}
          testID="loadout-collect-scan"
        />
      ) : null}

      <SourceOption
        icon="grid-outline"
        title="Pick equipment"
        subtitle="Tick off what you can see"
        onPress={onManual}
        testID="loadout-collect-manual"
      />

      {savedGyms.length > 0 ? (
        <View style={styles.gyms}>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>OR REUSE A SAVED GYM</Text>
            <View style={styles.dividerLine} />
          </View>
          {savedGyms.map((gym) => (
            <TouchableOpacity
              key={gym.id}
              style={styles.gymRow}
              onPress={() => onUseGym(gym)}
              testID={`loadout-collect-gym-${gym.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${gym.name}, ${itemLabel(gym.equipmentTypeIds.length)}`}
            >
              <View style={styles.gymIcon}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={color.$primary}
                />
              </View>
              <Text style={styles.gymName} numberOfLines={1}>
                {gym.name}
              </Text>
              <Text style={styles.gymCount}>
                {itemLabel(gym.equipmentTypeIds.length)}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={styles.manageRow}>
            <Ionicons name="settings-outline" size={13} color={color.$text4} />
            <Text style={styles.manageText}>
              Manage saved gyms in Train · Gyms
            </Text>
          </View>
        </View>
      ) : isLoadingGyms ? (
        // Deliberately quiet: saved gyms are an optional accelerator, and a
        // spinner over an empty area would imply the screen is not yet usable
        // when both real options above it already are.
        <Text style={styles.gymsLoading} testID="loadout-collect-gyms-loading">
          Checking your saved gyms…
        </Text>
      ) : null}
    </LoadoutScaffold>
  );
}

function SourceOption({
  icon,
  title,
  subtitle,
  badge,
  onPress,
  testID,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly subtitle: string;
  readonly badge?: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <TouchableOpacity
      style={styles.option}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={22} color={color.$primary} />
      </View>
      <View style={styles.optionBody}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{title}</Text>
          {badge ? (
            <Pill tone="primary" size="xs">
              {badge}
            </Pill>
          ) : null}
        </View>
        <Text style={styles.optionSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={color.$text3} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.$sm, paddingTop: space.$xs },
  heading: { fontSize: 24, fontWeight: "800", color: color.$text },
  blurb: { fontSize: 13.5, color: color.$text2, lineHeight: 20 },
  blurbStrong: { color: color.$text, fontWeight: "700" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$base,
    padding: space.$base,
    borderRadius: radius.$xl,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$border2,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.$lg,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  optionBody: { flex: 1, gap: 2 },
  optionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$sm,
  },
  optionTitle: { fontSize: 15, fontWeight: "700", color: color.$text },
  optionSub: { fontSize: 12, color: color.$text3, lineHeight: 17 },
  gyms: { gap: space.$sm },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: space.$md },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.$border2 },
  dividerLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: "700",
    color: color.$text4,
  },
  gymRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
  },
  gymIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  gymName: { flex: 1, fontSize: 13.5, fontWeight: "700", color: color.$text },
  gymCount: { fontSize: 10.5, color: color.$text4 },
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$xs,
    paddingTop: space.$xs,
  },
  manageText: { fontSize: 11, color: color.$text4 },
  gymsLoading: { fontSize: 11.5, color: color.$text4 },
});
