import { ScrollView } from "react-native";
import { View } from "@tamagui/core";
import type { DashboardActiveGoal } from "@/domain/models/dashboard";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { EmptyState } from "@/ui/components/EmptyState";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * Horizontal list of active-goal chips with progress indicators.
 * Ported 1:1 from `persistence-mobile/components/home/GoalsSection/`.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.4
 */

export type GoalsSectionProps = {
  goals: readonly DashboardActiveGoal[];
};

export function GoalsSection({ goals }: GoalsSectionProps) {
  return (
    <Column gap="sm" testID="goals-section">
      <Text variant="h4">Active Goals</Text>
      {goals.length === 0 ? (
        <EmptyState
          title="No active goals"
          description="Set a goal from the Progress tab to see it here."
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {goals.map((goal) => (
            <GoalChip key={goal.id} goal={goal} />
          ))}
        </ScrollView>
      )}
    </Column>
  );
}

function GoalChip({ goal }: { goal: DashboardActiveGoal }) {
  const clampedTarget = goal.target > 0 ? goal.target : 1;
  const pct = Math.max(0, Math.min(1, goal.current / clampedTarget));
  return (
    <Card
      testID={`goal-chip-${goal.id}`}
      minWidth={160}
      padding="$base"
      gap="$xs"
    >
      <Text variant="bodySmall" secondary numberOfLines={1}>
        {goal.title}
      </Text>
      <Row justify="between" gap="xs">
        <Text variant="h4">{goal.current}</Text>
        <Text variant="bodySmall" muted>
          / {goal.target} {goal.unit}
        </Text>
      </Row>
      <View
        height={4}
        borderRadius="$full"
        backgroundColor="$surfaceSecondary"
        overflow="hidden"
      >
        <View
          height="100%"
          width={`${pct * 100}%`}
          backgroundColor="$primary"
        />
      </View>
    </Card>
  );
}
