import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { color } from "@/ui/theme/tokens";

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
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 16,
  },
  activityCard: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  activityName: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
  },
});
