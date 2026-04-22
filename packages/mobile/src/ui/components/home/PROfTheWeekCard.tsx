import { Pressable } from "react-native";
import type { DashboardPROfTheWeek } from "@/domain/models/dashboard";
import type { RecordType } from "@/domain/models/record";
import { Badge } from "@/ui/components/Badge";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * PR-of-the-week card — single highest-impact PR from the last 7 days.
 *
 * Omitted entirely when payload is null (AC 5.7).
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.7
 */

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  "1rm": "1 Rep Max",
  "3rm": "3 Rep Max",
  "5rm": "5 Rep Max",
  "10rm": "10 Rep Max",
  max_weight: "Max Weight",
  max_reps: "Max Reps",
  best_time: "Best Time",
  longest_distance: "Longest Distance",
};

export type PROfTheWeekCardProps = {
  pr: DashboardPROfTheWeek;
  onPress?: () => void;
};

export function PROfTheWeekCard({ pr, onPress }: PROfTheWeekCardProps) {
  const body = (
    <Card padding="$base" gap="$xs" testID="pr-of-the-week">
      <Row gap="xs">
        <Badge label="PR" variant="primary" size="sm" />
        <Text variant="label" muted>
          PR OF THE WEEK
        </Text>
      </Row>
      <Column gap="xs">
        <Text variant="h3" numberOfLines={1}>
          {pr.exerciseName}
        </Text>
        <Row gap="xs">
          <Text variant="h4">
            {pr.value} {pr.unit}
          </Text>
          <Text variant="bodySmall" secondary>
            {RECORD_TYPE_LABELS[pr.recordType]}
          </Text>
        </Row>
      </Column>
    </Card>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{body}</Pressable>;
  }
  return body;
}
