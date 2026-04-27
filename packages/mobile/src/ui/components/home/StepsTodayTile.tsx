import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { HealthPermissionStatus } from "@/domain/ports/health.port";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/homeLegacyTheme";
import { SimpleLineGraph } from "./SimpleLineGraph";

/**
 * Steps-today MyProgress tile. Visual structure ported verbatim from
 * `persistence-mobile/components/home/StepsTodayTile/` (title, big
 * value, SimpleLineGraph). Three states preserved from the M1 scope
 * — granted / denied / unavailable — so AC 7.3 and AC 7.5 still hold:
 *
 * - granted + value: legacy look (count + line graph)
 * - denied / not_determined: "Connect Health" CTA tile
 * - unavailable: platform-aware muted copy
 */

function unavailableMessage(platformOS: typeof Platform.OS): string {
  if (platformOS === "android") return "Not available on Android yet";
  if (platformOS === "ios") return "Health not available on this iOS build";
  return "Health data not available";
}

export type StepsTodayTileProps = {
  stepsToday: number | null;
  isAvailable: boolean;
  permissionStatus: HealthPermissionStatus;
  lastReadAt: string | null;
  onConnectPress: () => void;
  history?: { date: Date; steps: number }[];
  /**
   * True when the value comes from the simulator-mock adapter rather
   * than a live HealthKit / Health Connect read. Renders a small chip
   * so reviewers don't mistake the deterministic 4812 fixture for a
   * real reading. Cosmetic only; doesn't change tile behaviour.
   */
  isMock?: boolean;
};

export function StepsTodayTile({
  stepsToday,
  isAvailable,
  permissionStatus,
  onConnectPress,
  history = [],
  isMock = false,
}: StepsTodayTileProps) {
  if (!isAvailable) {
    return (
      <View style={styles.container} testID="steps-tile-unavailable">
        <Text style={styles.title}>Steps Today</Text>
        <Text style={styles.unavailable}>
          {unavailableMessage(Platform.OS)}
        </Text>
      </View>
    );
  }

  const granted = permissionStatus.steps === "granted";
  if (!granted) {
    return (
      <Pressable onPress={onConnectPress} testID="steps-tile-connect">
        <View style={styles.container}>
          <Text style={styles.title}>Steps Today</Text>
          <Text style={styles.connectLabel}>Connect Health</Text>
          <Text style={styles.connectCaption}>Tap to grant permission</Text>
        </View>
      </Pressable>
    );
  }

  const value = (stepsToday ?? 0).toLocaleString();

  return (
    <View style={styles.container} testID="steps-tile-granted">
      {isMock && (
        <View style={styles.mockChip} testID="steps-tile-mock-chip">
          <Text style={styles.mockChipText}>MOCK</Text>
        </View>
      )}
      <Text style={styles.title}>Steps Today</Text>
      <Text style={styles.value} testID="steps-tile-value">
        {value}
      </Text>
      {history.length > 0 ? (
        <View style={styles.graphContainer}>
          <SimpleLineGraph
            data={history.map((h) => h.steps)}
            width={150}
            height={60}
            color={Colors.success.DEFAULT}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.small,
  },
  title: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  value: {
    ...Typography.h3,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  graphContainer: {
    marginTop: Spacing.xs,
  },
  unavailable: {
    ...Typography.body2,
    color: Colors.text.tertiary,
  },
  connectLabel: {
    ...Typography.h4,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  connectCaption: {
    ...Typography.caption,
    color: Colors.text.secondary,
  },
  mockChip: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.surface.tertiary,
  },
  mockChipText: {
    ...Typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.text.tertiary,
  },
});
