import { Pressable } from "react-native";
import type { DashboardRecentActivity } from "@/domain/models/dashboard";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { EmptyState } from "@/ui/components/EmptyState";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * Vertical list of recently-completed sessions. Ported 1:1 from
 * `persistence-mobile/components/home/RecentActivitySection/`.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.3
 *       · STORY-007 AC 7.2
 */

export type RecentActivitySectionProps = {
  activities: readonly DashboardRecentActivity[];
  onActivityPress: (sessionId: string) => void;
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "";
  const mins = Math.max(0, Math.floor(diffMs / 60_000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const mins = Math.max(0, Math.round(seconds / 60));
  return `${mins} min`;
}

export function RecentActivitySection({
  activities,
  onActivityPress,
}: RecentActivitySectionProps) {
  return (
    <Column gap="sm" testID="recent-activity-section">
      <Text variant="h4">Recent Activity</Text>
      {activities.length === 0 ? (
        <EmptyState
          title="No recent activity"
          description="Completed workouts from the last 7 days will appear here."
        />
      ) : (
        <Column gap="xs">
          {activities.map((activity) => (
            <Pressable
              key={activity.workoutSessionId}
              onPress={() => onActivityPress(activity.workoutSessionId)}
              testID={`recent-activity-${activity.workoutSessionId}`}
            >
              <Card pressable padding="$base" gap="$xs">
                <Row justify="between" gap="xs">
                  <Text variant="body" numberOfLines={1}>
                    {activity.workoutName}
                  </Text>
                  <Text variant="caption" muted>
                    {formatRelative(activity.completedAt)}
                  </Text>
                </Row>
                <Text variant="caption" muted>
                  {formatDuration(activity.durationSeconds)}
                </Text>
              </Card>
            </Pressable>
          ))}
        </Column>
      )}
    </Column>
  );
}
