/**
 * SessionSummaryPresenter — final review screen on Finish (Stories
 * 006 + 007).
 *
 * Ported 1:1 from
 * `persistence-mobile/components/workouts/WorkoutSummaryScreen/WorkoutSummaryScreen.tsx`
 * (M3 Phase 3b legacy parity, decided between Brad and me on PR #61):
 *
 *   - Title: "Workout Complete!" (capital + exclamation)
 *   - Subtitle: "You've completed N total workouts. Keep the momentum
 *     going!" — N is null pre-server; pluralisation handled inline
 *     ("workout" / "workouts")
 *   - X close button right-aligned at the top of the scroll (no
 *     top-bar with title + spacer)
 *   - 3-stat strip: Workouts Completed / Records Hit / Total Volume
 *     (Brad's pick — the third tile was "Achievements" in legacy but
 *     the achievement infrastructure was never wired; total volume is
 *     a meaningful session-scoped stat that fills the slot honestly)
 *   - "Personal Records Hit! 🏆" section header
 *   - PR card body: `previous → new` with strikethrough on previous
 *     when `previousValue != null`; fallback to just `new value` when
 *     local prediction (pre-server) hasn't seen a prior baseline.
 *     Matches legacy line 83-91.
 *   - Continue button (no "View Achievements" gate — the achievements
 *     infrastructure isn't built and Brad confirmed legacy never
 *     wired it either).
 *
 * Data shape comes pre-merged from `SessionSummaryContainer` — server
 * data wins for PRs + workoutsThisMonth, local fills duration /
 * totalVolume. The presenter just renders.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006, STORY-007
 */

import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Btn } from "@/ui/components/foundation/Btn";
import {
  IconCheck,
  IconChevronR,
  IconDumbbell,
  IconMedal,
  IconX,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";
import type { SummaryPersonalRecord } from "@/ui/containers/SessionSummaryContainer";

const RECORD_TYPE_LABEL: Record<SummaryPersonalRecord["recordType"], string> = {
  "1rm": "1 Rep Max",
  "3rm": "3 Rep Max",
  "5rm": "5 Rep Max",
  "10rm": "10 Rep Max",
  max_weight: "Max Weight",
  // Added alongside the broadened server-side PR detection in PR #61.
  // The legacy app never had a `max_volume` enum value; "Max Volume"
  // is the chosen mobile label for it.
  max_volume: "Max Volume",
  max_reps: "Max Reps",
  best_time: "Best Time",
  longest_distance: "Longest Distance",
};

export type SessionSummaryPresenterProps = {
  /**
   * Total weight × reps lifted in the just-completed session. Sourced
   * locally from `calculateSummary`; doesn't require the server
   * response.
   */
  totalVolume: number;
  /**
   * Number of canonical PRs surfaced. Equal to `personalRecords.length` —
   * passed separately so the stat tile + the section's empty-state
   * branch don't both have to compute it.
   */
  recordsHit: number;
  /**
   * The user's completed-workout count for the current calendar
   * month (including the just-recorded session). `null` while the
   * bulk-record POST is still pending — the stat tile shows an em-
   * dash and the subtitle copy drops the count entirely until the
   * server response arrives. Renamed from `totalWorkoutsCompleted`
   * (all-time count) after the device review of Phase 3b.
   */
  workoutsThisMonth: number | null;
  personalRecords: SummaryPersonalRecord[];
  onSave: () => void;
  onClose: () => void;
};

const formatPRValue = (
  record: SummaryPersonalRecord,
  value: number,
): string => {
  // Whitelist-style switch — every RecordType handled explicitly.
  // Inspector Brad PR #62 (low severity) caught the previous
  // "everything-else → kg" fallthrough: if the backend ever emits
  // best_time or longest_distance (it doesn't today, but the
  // RecordType enum allows them), the card would render
  // "45.0 kg" for a 45-second time PR. Exhaustive switch + no
  // default branch means TS will flag this site at compile time if
  // a new record type lands without a chosen formatter.
  switch (record.recordType) {
    case "1rm":
    case "3rm":
    case "5rm":
    case "10rm":
    case "max_weight":
    case "max_volume":
      return `${value.toFixed(1)} kg`;
    case "max_reps":
      return `${value.toFixed(0)} reps`;
    case "best_time":
      return `${value.toFixed(1)} s`;
    case "longest_distance":
      return `${value.toFixed(1)} m`;
  }
};

const formatVolume = (volume: number): string => {
  if (volume === 0) return "0 kg";
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)} t`;
  return `${Math.round(volume)} kg`;
};

export function SessionSummaryPresenter(props: SessionSummaryPresenterProps) {
  const {
    totalVolume,
    recordsHit,
    workoutsThisMonth,
    personalRecords,
    onSave,
    onClose,
  } = props;

  return (
    <View style={styles.container} testID="session-summary-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="session-summary-scroll"
      >
        {/* Right-aligned close — no top-bar / centred title / spacer.
            Matches legacy WorkoutSummaryScreen.tsx:40-44. */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerCloseButton}
            hitSlop={8}
            accessibilityLabel="Close summary"
            testID="session-summary-close"
          >
            <IconX size={24} color={color.$text3} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Workout Complete!</Text>
        <Text style={styles.subtitle}>
          {workoutsThisMonth == null
            ? "Keep the momentum going!"
            : `You've completed ${workoutsThisMonth} ${
                workoutsThisMonth === 1 ? "workout" : "workouts"
              } this month. Keep the momentum going!`}
        </Text>

        {/* 3-stat strip — same flex-row of cards as legacy, third
            tile carries Total Volume (Brad's pick replacing legacy's
            Achievements column since that infrastructure was never
            wired). */}
        <View style={styles.statsRow}>
          <View
            style={styles.statCard}
            testID="summary-stat-workouts-this-month"
          >
            <IconCheck size={28} color={color.$success} />
            <Text style={styles.statValue}>
              {workoutsThisMonth == null ? "—" : workoutsThisMonth}
            </Text>
            <Text style={styles.statLabel}>Workouts this month</Text>
          </View>
          <View style={styles.statCard} testID="summary-stat-records-hit">
            <IconMedal size={28} color={color.$gold} />
            <Text style={styles.statValue}>{recordsHit}</Text>
            <Text style={styles.statLabel}>Records Hit</Text>
          </View>
          <View style={styles.statCard} testID="summary-stat-total-volume">
            <IconDumbbell size={28} color={color.$info} />
            <Text style={styles.statValue}>{formatVolume(totalVolume)}</Text>
            <Text style={styles.statLabel}>Total Volume</Text>
          </View>
        </View>

        {personalRecords.length > 0 && (
          <View style={styles.section} testID="summary-pr-section">
            <Text style={styles.sectionTitle}>Personal Records Hit! 🏆</Text>
            {personalRecords.map((pr, index) => (
              <View
                key={`${pr.exerciseId}-${pr.recordType}-${index}`}
                style={styles.prCard}
                testID={`summary-pr-${pr.exerciseId}-${pr.recordType}`}
              >
                <View style={styles.prHeader}>
                  <IconMedal size={24} color={color.$gold} />
                  <Text style={styles.prExerciseName} numberOfLines={1}>
                    {pr.exerciseName}
                  </Text>
                </View>
                <View style={styles.prDetails}>
                  <Text style={styles.prType}>
                    {RECORD_TYPE_LABEL[pr.recordType]}
                  </Text>
                  <View style={styles.prValues}>
                    {pr.previousValue != null ? (
                      <>
                        <Text style={styles.prPreviousValue}>
                          {formatPRValue(pr, pr.previousValue)}
                        </Text>
                        <Text style={styles.prArrow}>→</Text>
                        <Text style={styles.prNewValue}>
                          {formatPRValue(pr, pr.newValue)}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.prNewValue}>
                        {formatPRValue(pr, pr.newValue)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.continueButtonContainer}>
          <Btn
            full
            variant="filled"
            tone="primary"
            size="lg"
            icon={<IconChevronR size={18} color={color.$primaryInk} />}
            onPress={onSave}
            testID="summary-save-button"
          >
            Continue
          </Btn>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  header: {
    alignItems: "flex-end",
  },
  headerCloseButton: {
    padding: Spacing.xs,
  },
  title: {
    ...Typography.h2,
    color: color.$text,
    textAlign: "center",
    fontWeight: "700",
  },
  subtitle: {
    ...Typography.body1,
    color: color.$text2,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 14,
    padding: Spacing.lg,
    alignItems: "center",
    gap: Spacing.xs,
  },
  statValue: {
    ...Typography.h2,
    color: color.$text,
    fontWeight: "700",
  },
  statLabel: {
    ...Typography.body2,
    color: color.$text3,
    textAlign: "center",
  },
  section: {
    gap: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
    color: color.$text,
    fontWeight: "600",
  },
  prCard: {
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$goldDim,
    borderRadius: 14,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  prHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  prExerciseName: {
    ...Typography.body1,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
  },
  prDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginLeft: 32,
  },
  prType: {
    ...Typography.body2,
    color: color.$text3,
  },
  prValues: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  prNewValue: {
    ...Typography.body1,
    color: color.$gold,
    fontWeight: "600",
  },
  prArrow: {
    ...Typography.body2,
    color: color.$text3,
  },
  prPreviousValue: {
    ...Typography.body2,
    color: color.$text4,
    textDecorationLine: "line-through",
  },
  continueButtonContainer: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
  },
});
