/**
 * SessionSummaryPresenter — final review screen on Finish/Discard.
 * (M3, Stories 006 + 007.)
 *
 * Ported from `persistence-mobile/components/workouts/WorkoutSummaryScreen`
 * with the V2 Container/Presenter shape — all calculations come in
 * as `summary` from `sessionService.calculateSummary` +
 * `detectPersonalRecords`. Save / Discard intent is driven by the
 * container.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006, STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { PersonalRecord, RecordType } from "@/domain/models/record";
import type { SessionSummary } from "@/domain/models/session";

const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  "1rm": "1 Rep Max",
  "3rm": "3 Rep Max",
  "5rm": "5 Rep Max",
  "10rm": "10 Rep Max",
  max_weight: "Max Weight",
  max_reps: "Max Reps",
  best_time: "Best Time",
  longest_distance: "Longest Distance",
};

export type SessionSummaryPresenterProps = {
  summary: SessionSummary;
  onSave: () => void;
  onClose: () => void;
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatVolume = (volume: number): string => {
  if (volume === 0) return "0 kg";
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)} t`;
  return `${Math.round(volume)} kg`;
};

const formatPRValue = (record: PersonalRecord): string => {
  // Epley 1RM is unitless kg. Round to 1dp for display.
  if (record.recordType === "1rm") return `${record.value.toFixed(1)} kg`;
  return record.value.toFixed(1);
};

export function SessionSummaryPresenter(props: SessionSummaryPresenterProps) {
  const { summary } = props;

  return (
    <View style={styles.container} testID="session-summary-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={props.onClose}
          style={styles.closeButton}
          accessibilityLabel="Close summary"
          testID="session-summary-close"
        >
          <Ionicons name="close" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          Workout complete
        </Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="session-summary-scroll"
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard} testID="summary-stat-duration">
            <Ionicons name="time" size={24} color={Colors.primary.DEFAULT} />
            <Text style={styles.statValue}>
              {formatDuration(summary.duration)}
            </Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
          <View style={styles.statCard} testID="summary-stat-volume">
            <Ionicons name="barbell" size={24} color={Colors.warning.DEFAULT} />
            <Text style={styles.statValue}>
              {formatVolume(summary.totalVolume)}
            </Text>
            <Text style={styles.statLabel}>Total volume</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard} testID="summary-stat-exercises">
            <Ionicons
              name="checkmark-circle"
              size={24}
              color={Colors.success.DEFAULT}
            />
            <Text style={styles.statValue}>
              {summary.exercisesCompleted} / {summary.totalExercises}
            </Text>
            <Text style={styles.statLabel}>Exercises</Text>
          </View>
          <View style={styles.statCard} testID="summary-stat-sets">
            <Ionicons name="repeat" size={24} color={Colors.success.DEFAULT} />
            <Text style={styles.statValue}>
              {summary.setsCompleted} / {summary.totalSets}
            </Text>
            <Text style={styles.statLabel}>Sets</Text>
          </View>
        </View>

        {summary.personalRecords.length > 0 && (
          <View style={styles.section} testID="summary-pr-section">
            <Text style={styles.sectionTitle}>Personal records</Text>
            {summary.personalRecords.map((pr) => (
              <View
                key={pr.id}
                style={styles.prCard}
                testID={`summary-pr-${pr.exerciseId}`}
              >
                <View style={styles.prHeader}>
                  <Ionicons
                    name="medal"
                    size={20}
                    color={Colors.warning.DEFAULT}
                  />
                  <Text style={styles.prExerciseName} numberOfLines={1}>
                    {pr.exerciseName}
                  </Text>
                </View>
                <View style={styles.prDetails}>
                  <Text style={styles.prType}>
                    {RECORD_TYPE_LABEL[pr.recordType]}
                  </Text>
                  <Text style={styles.prValue}>{formatPRValue(pr)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.footerButton, styles.primaryButton]}
          onPress={props.onSave}
          testID="summary-save-button"
        >
          <Text style={styles.primaryLabel}>Continue</Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={Colors.text.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
    backgroundColor: Colors.surface.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  spacer: { width: 36 },
  title: {
    ...Typography.h3,
    flex: 1,
    textAlign: "center",
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: "center",
    gap: Spacing.xs,
  },
  statValue: {
    ...Typography.h2,
    color: Colors.text.primary,
  },
  statLabel: {
    ...Typography.caption,
    color: Colors.text.secondary,
  },
  section: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h4,
    color: Colors.text.primary,
  },
  prCard: {
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  prHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  prExerciseName: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
    flex: 1,
  },
  prDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  prType: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  prValue: {
    ...Typography.h4,
    color: Colors.warning.DEFAULT,
  },
  footer: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surface.border,
    backgroundColor: Colors.surface.primary,
  },
  footerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  primaryButton: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  primaryLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
