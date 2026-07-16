import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { HealthPermissionStatus } from "@/domain/ports/health.port";
import { color } from "@/ui/theme/tokens";
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
};

export function StepsTodayTile({
  stepsToday,
  isAvailable,
  permissionStatus,
  onConnectPress,
  history = [],
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
            color={color.$success}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  graphContainer: {
    marginTop: 4,
  },
  unavailable: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text3,
  },
  connectLabel: {
    fontSize: 18,
    fontWeight: "600" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
  connectCaption: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text2,
  },
});
