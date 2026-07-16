import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { color } from "@/ui/theme/tokens";
import { BodyFatTile } from "./BodyFatTile";
import { BodyWeightTile } from "./BodyWeightTile";
import { EnergyTile } from "./EnergyTile";
import { StepsTodayTile } from "./StepsTodayTile";
import { WorkoutsThisMonthTile } from "./WorkoutsThisMonthTile";

/**
 * Tile grid (3 rows of 2). Ported verbatim from
 * `persistence-mobile/components/home/MyProgressSection/` — same row
 * layout, same gap, same placeholder column in the last row.
 */

export interface MyProgressSectionProps {
  readonly workoutsThisMonth: number;
  readonly workoutsLastMonth: number;
  readonly activeEnergy: number;
  readonly basalEnergy: number;
  readonly standTime: number;
  readonly bodyWeight: number | null;
  readonly bodyWeightUnit?: "kg" | "lbs";
  readonly bodyWeightHistory: { date: Date; value: number }[];
  readonly bodyFat: number | null;
  readonly bodyFatHistory: { date: Date; value: number }[];
  readonly stepsToday: number;
  readonly stepsHistory: { date: Date; steps: number }[];
  readonly healthIsAvailable: boolean;
  readonly healthPermissionStatus: HealthPermissionStatus;
  readonly latestBodyWeight: HealthWeight | null;
  readonly onConnectHealthPress: () => void;
  readonly onViewAllPress: () => void;
}

export function MyProgressSection({
  workoutsThisMonth,
  workoutsLastMonth,
  activeEnergy,
  basalEnergy,
  standTime,
  bodyWeight,
  bodyWeightUnit = "kg",
  bodyWeightHistory,
  bodyFat,
  bodyFatHistory,
  stepsToday,
  stepsHistory,
  healthIsAvailable,
  healthPermissionStatus,
  onConnectHealthPress,
  onViewAllPress,
}: MyProgressSectionProps) {
  return (
    <View style={styles.container} testID="my-progress-section">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>My Progress</Text>
        <TouchableOpacity
          onPress={onViewAllPress}
          testID="my-progress-view-all"
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        <View style={styles.row}>
          <WorkoutsThisMonthTile
            current={workoutsThisMonth}
            lastMonth={workoutsLastMonth}
          />
          <EnergyTile
            activeEnergy={activeEnergy}
            basalEnergy={basalEnergy}
            standTime={standTime}
          />
        </View>
        <View style={styles.row}>
          <BodyWeightTile
            currentValue={bodyWeight}
            unit={bodyWeightUnit}
            history={bodyWeightHistory}
          />
          <BodyFatTile currentValue={bodyFat} history={bodyFatHistory} />
        </View>
        <View style={styles.row}>
          <StepsTodayTile
            stepsToday={stepsToday}
            history={stepsHistory}
            isAvailable={healthIsAvailable}
            permissionStatus={healthPermissionStatus}
            lastReadAt={null}
            onConnectPress={onConnectHealthPress}
          />
          <View style={styles.placeholder} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$primary,
  },
  grid: {
    gap: 16,
  },
  row: {
    flexDirection: "row",
    gap: 16,
  },
  placeholder: {
    flex: 1,
  },
});
