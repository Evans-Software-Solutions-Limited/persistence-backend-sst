import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/homeLegacyTheme";

/**
 * Recent activity list. Ported verbatim from
 * `persistence-mobile/components/home/RecentActivitySection/` — same
 * row cards, same relative-time caption.
 */

interface RecentActivity {
  readonly workout_session_id: string;
  readonly workout_name: string;
  readonly completed_at: string;
}

interface RecentActivitySectionProps {
  readonly activities: readonly RecentActivity[];
  readonly onActivityPress?: (sessionId: string) => void;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "";
  const mins = Math.max(0, Math.floor(diffMs / 60_000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function RecentActivitySection({
  activities,
  onActivityPress,
}: RecentActivitySectionProps) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="recent-activity-section">
      <Text style={styles.sectionTitle}>Recent Activity</Text>
      {activities.map((activity) => {
        const body = (
          <View style={styles.activityCard}>
            <Text style={styles.activityName}>{activity.workout_name}</Text>
            <Text style={styles.activityTime}>
              {formatRelativeTime(activity.completed_at)}
            </Text>
          </View>
        );
        return onActivityPress ? (
          <TouchableOpacity
            key={activity.workout_session_id}
            onPress={() => onActivityPress(activity.workout_session_id)}
            testID={`recent-activity-${activity.workout_session_id}`}
          >
            {body}
          </TouchableOpacity>
        ) : (
          <View
            key={activity.workout_session_id}
            testID={`recent-activity-${activity.workout_session_id}`}
          >
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  activityCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  activityName: {
    ...Typography.body1,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  activityTime: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
});
