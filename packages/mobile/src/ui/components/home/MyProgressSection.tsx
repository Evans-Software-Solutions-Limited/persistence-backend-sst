import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";
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
  /**
   * True when the active health adapter is the simulator-mock fixture
   * (per `HealthPort.isMock`). The three tiles that consume health
   * data render a small `MOCK` chip when set, so reviewers don't
   * mistake the deterministic 4812 / 312 / 74.5 numbers for a bug.
   */
  readonly healthIsMock?: boolean;
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
  healthIsMock = false,
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
            isMock={healthIsMock}
          />
        </View>
        <View style={styles.row}>
          <BodyWeightTile
            currentValue={bodyWeight}
            unit={bodyWeightUnit}
            history={bodyWeightHistory}
            isMock={healthIsMock}
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
            isMock={healthIsMock}
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
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  viewAllText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
  },
  grid: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  placeholder: {
    flex: 1,
  },
});
