import { Text, View } from "@tamagui/core";
import { Card, IconBtn } from "@/ui/components/foundation";
import { color } from "@/ui/theme/tokens";
import { IconTarget, IconEdit, IconTrash } from "@/ui/components/icons";
import { CoachAttribution } from "./CoachAttribution";
import type { Goal } from "@/domain/models/goal";

/**
 * <GoalCard> — one athlete goal tile for the Train overview's Goals section
 * (M16). Reuses the home GoalsSection visual pattern MINUS the progress bar
 * (decision #2 — a goal's `currentValue` is manual with no athlete update path,
 * so a bar would read permanently empty): icon + type name + target
 * (value/unit if set) + target date, plus a <CoachAttribution> badge on
 * coach-assigned goals.
 *
 * Self-set goals expose edit + delete (handlers passed by the container).
 * Coach-assigned goals are VIEW-ONLY (cross-cuts § 2.2 — removal is
 * out-of-band): no edit/delete affordance, just the attribution badge. The
 * container only wires `onEdit`/`onDelete` for self-set goals; this component
 * additionally hard-gates on `isCoachAssigned` so a coach-assigned goal can
 * never render a mutation control.
 */

export type GoalCardProps = {
  goal: Goal;
  onEdit?: (goal: Goal) => void;
  onDelete?: (goal: Goal) => void;
  testID?: string;
};

export function GoalCard({ goal, onEdit, onDelete, testID }: GoalCardProps) {
  const showControls = !goal.isCoachAssigned;
  const targetParts = [
    goal.targetValue != null
      ? `${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ""}`
      : null,
    goal.targetDate ? `Target ${goal.targetDate}` : null,
  ].filter(Boolean);
  const meta = targetParts.join(" · ");

  return (
    <Card
      pad={14}
      radius={14}
      testID={testID ?? `goal-card-${goal.id}`}
      accessibilityLabel={`Goal: ${goal.goalTypeName ?? "Goal"}`}
    >
      <View flexDirection="row" alignItems="center" gap={12}>
        <IconTarget size={20} color={color.$primary} />
        <View flex={1} minWidth={0}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={15}
            color="$text"
            numberOfLines={1}
          >
            {goal.goalTypeName ?? "Goal"}
          </Text>
          {meta ? (
            <Text fontFamily="$body" fontSize={12} color="$text3" marginTop={2}>
              {meta}
            </Text>
          ) : null}
          {goal.isCoachAssigned && goal.assignedByName ? (
            <View marginTop={6}>
              <CoachAttribution
                name={goal.assignedByName}
                label="Set by Coach"
                testID={`goal-card-${goal.id}-coach`}
              />
            </View>
          ) : null}
        </View>
        {showControls && (onEdit || onDelete) ? (
          <View flexDirection="row" alignItems="center" gap={4}>
            {onEdit ? (
              <IconBtn
                icon={<IconEdit size={16} />}
                tone="ghost"
                onPress={() => onEdit(goal)}
                accessibilityLabel="Edit goal"
                testID={`goal-card-${goal.id}-edit`}
              />
            ) : null}
            {onDelete ? (
              <IconBtn
                icon={<IconTrash size={16} />}
                tone="ghost"
                onPress={() => onDelete(goal)}
                accessibilityLabel="Delete goal"
                testID={`goal-card-${goal.id}-delete`}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}
