import { Pressable } from "react-native";
import { View } from "@tamagui/core";
import type { DashboardProgress } from "@/domain/models/dashboard";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";
import { StepsTodayTile } from "./StepsTodayTile";

/**
 * Tile grid — workouts this month, streak, body weight, body fat, steps,
 * active energy. Ported 1:1 from
 * `persistence-mobile/components/home/MyProgressSection/`.
 *
 * M1 scope: basal / standTime tiles are placeholder zeros per parent
 * spec; only active energy is wired live.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.5
 *       · specs/07-health-integration/design.md § M1 scope (non-goals)
 */

export type MyProgressSectionProps = {
  progress: DashboardProgress;
  latestMeasurement: {
    weightKg: number | null;
    bodyFatPercentage: number | null;
  } | null;
  stepsToday: number | null;
  activeCaloriesToday: number | null;
  latestBodyWeight: HealthWeight | null;
  healthIsAvailable: boolean;
  healthPermissionStatus: HealthPermissionStatus;
  lastHealthReadAt: string | null;
  onConnectHealthPress: () => void;
  onViewAllPress: () => void;
};

export function MyProgressSection({
  progress,
  latestMeasurement,
  stepsToday,
  activeCaloriesToday,
  latestBodyWeight,
  healthIsAvailable,
  healthPermissionStatus,
  lastHealthReadAt,
  onConnectHealthPress,
  onViewAllPress,
}: MyProgressSectionProps) {
  const weight = latestMeasurement?.weightKg ?? latestBodyWeight?.value ?? null;
  const weightUnit = latestBodyWeight?.unit === "lbs" ? "lbs" : "kg";

  return (
    <Column gap="sm" testID="my-progress-section">
      <Row justify="between">
        <Text variant="h4">My Progress</Text>
        <Pressable onPress={onViewAllPress} testID="my-progress-view-all">
          <Text variant="bodySmall" color="$primary">
            See all
          </Text>
        </Pressable>
      </Row>
      <View flexDirection="row" flexWrap="wrap" gap={12}>
        <ProgressTile
          label="WORKOUTS THIS MONTH"
          value={String(progress.workoutsThisMonth)}
          caption={`Last month: ${progress.workoutsLastMonth}`}
          testID="tile-workouts-month"
        />
        <ProgressTile
          label="STREAK"
          value={`${progress.streak}d`}
          caption={progress.streak > 0 ? "Keep it going" : "Start today"}
          testID="tile-streak"
        />
        <ProgressTile
          label="BODY WEIGHT"
          value={weight !== null ? `${weight.toFixed(1)} ${weightUnit}` : "—"}
          caption={weight !== null ? "Latest" : "No readings"}
          testID="tile-body-weight"
        />
        <ProgressTile
          label="BODY FAT"
          value={
            latestMeasurement?.bodyFatPercentage !== null &&
            latestMeasurement?.bodyFatPercentage !== undefined
              ? `${latestMeasurement.bodyFatPercentage.toFixed(1)}%`
              : "—"
          }
          caption={
            latestMeasurement?.bodyFatPercentage != null
              ? "Latest"
              : "No readings"
          }
          testID="tile-body-fat"
        />
        <StepsTodayTile
          stepsToday={stepsToday}
          isAvailable={healthIsAvailable}
          permissionStatus={healthPermissionStatus}
          lastReadAt={lastHealthReadAt}
          onConnectPress={onConnectHealthPress}
        />
        <ProgressTile
          label="ACTIVE ENERGY"
          value={
            activeCaloriesToday !== null ? `${activeCaloriesToday} kcal` : "—"
          }
          caption="Today"
          testID="tile-active-energy"
        />
      </View>
    </Column>
  );
}

function ProgressTile({
  label,
  value,
  caption,
  testID,
}: {
  label: string;
  value: string;
  caption: string;
  testID: string;
}) {
  return (
    <Card testID={testID} padding="$base" gap="$xs" minWidth={150} flexGrow={1}>
      <Text variant="label" muted>
        {label}
      </Text>
      <Text variant="h3">{value}</Text>
      <Text variant="caption" muted>
        {caption}
      </Text>
    </Card>
  );
}
