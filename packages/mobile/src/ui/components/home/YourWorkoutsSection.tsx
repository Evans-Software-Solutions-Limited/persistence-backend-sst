import { Pressable, ScrollView } from "react-native";
import type { DashboardRecentWorkout } from "@/domain/models/dashboard";
import { Badge } from "@/ui/components/Badge";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { EmptyState } from "@/ui/components/EmptyState";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * Horizontal carousel of recent workout templates. Ported 1:1 from
 * `persistence-mobile/components/home/YourWorkoutsSection/`.
 *
 * Tapping routes to `/workouts` (existing placeholder) — no M1 popover.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.2
 */

export type YourWorkoutsSectionProps = {
  workouts: readonly DashboardRecentWorkout[];
  onWorkoutPress: (workoutId: string) => void;
  onViewAllPress: () => void;
};

export function YourWorkoutsSection({
  workouts,
  onWorkoutPress,
  onViewAllPress,
}: YourWorkoutsSectionProps) {
  return (
    <Column gap="sm" testID="your-workouts-section">
      <Row justify="between">
        <Text variant="h4">Your Workouts</Text>
        <Pressable onPress={onViewAllPress} testID="your-workouts-view-all">
          <Text variant="bodySmall" color="$primary">
            See all
          </Text>
        </Pressable>
      </Row>
      {workouts.length === 0 ? (
        <EmptyState
          title="No workouts yet"
          description="Create a workout from the Workouts tab to get started."
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {workouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              onPress={onWorkoutPress}
            />
          ))}
        </ScrollView>
      )}
    </Column>
  );
}

function WorkoutCard({
  workout,
  onPress,
}: {
  workout: DashboardRecentWorkout;
  onPress: (workoutId: string) => void;
}) {
  const assignedLabel =
    workout.assignedByType === "personal_trainer"
      ? "PT"
      : workout.assignedByType === "physiotherapist"
        ? "Physio"
        : null;

  return (
    <Pressable
      onPress={() => onPress(workout.id)}
      testID={`workout-card-${workout.id}`}
    >
      <Card pressable width={220} padding="$base" gap="$xs">
        <Row justify="between" gap="xs">
          <Text variant="h4" numberOfLines={1}>
            {workout.name ?? "Untitled workout"}
          </Text>
          {assignedLabel ? (
            <Badge label={assignedLabel} variant="info" size="sm" />
          ) : null}
        </Row>
        {workout.description ? (
          <Text variant="bodySmall" secondary numberOfLines={2}>
            {workout.description}
          </Text>
        ) : null}
        <Row gap="xs">
          <Text variant="caption" muted>
            {workout.estimatedDurationMinutes
              ? `${workout.estimatedDurationMinutes} min`
              : "Duration —"}
          </Text>
        </Row>
      </Card>
    </Pressable>
  );
}
