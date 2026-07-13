import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type {
  Workout,
  WorkoutExercise,
  WorkoutHistory,
} from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import type { WeightUnit } from "@/shared/utils";
import {
  formatMinutesFromSeconds,
  formatRelativeDay,
  formatShortDate,
  formatVolumeKg,
} from "@/ui/presenters/workoutDetailFormat";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Pure presenter for the workout-detail SCREEN, ported 1:1 from the v3
 * prototype (`workout-detail.jsx`). Full-screen modal route at
 * `/(app)/workouts/[id]`.
 *
 * Layout (prototype-faithful):
 *   - Sticky header: back · title · owner edit button.
 *   - HERO (primary-gradient): equipment·WORKOUT eyebrow, name, description,
 *     a 3-stat row (DURATION / EXERCISES / TOTAL SETS), muscle pills.
 *   - HISTORY block (fed by `useWorkoutHistory`): LAST DONE / COMPLETED × /
 *     AVG TIME + a last-session recap footer. Rendered only when the user has
 *     completed this workout ≥1×; never zeros-as-data (a quiet "Not done yet"
 *     otherwise).
 *   - THE PLAN: single exercises (numbered) + supersets (centred letter pill
 *     on a connector, 3px left accent on members, closing connector).
 *   - Start CTA + tap-exercise → exercise detail (unchanged behaviour).
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 10; STORY-005/008
 *       (legacy STORY-007 ACs 7.1, 7.2, 7.4 preserved)
 */

interface WorkoutDetailPresenterProps {
  readonly workout: Workout | null;
  readonly history: WorkoutHistory | null;
  readonly isHistoryLoading: boolean;
  /** Distinct muscle labels for the hero pills (derived; container-supplied). */
  readonly muscles: readonly string[];
  /** Dominant equipment label for the eyebrow, or null → just "WORKOUT". */
  readonly equipmentLabel: string | null;
  readonly isOwner: boolean;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  /** Display-unit preference for the history volume stat. Defaults to "kg". */
  readonly weightUnit?: WeightUnit;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onStartWorkout: (workoutId: string) => void;
  readonly onExercisePress: (exerciseId: string) => void;
}

const SUPERSET_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
/** Hero gradient: faint primary wash → surface, matching the prototype. */
const HERO_GRADIENT: readonly [string, string] = [
  "rgba(34,211,238,0.16)",
  Colors.background.tertiary,
];
const MAX_MUSCLE_PILLS = 5;

type PlanBlock =
  | { kind: "single"; exercise: WorkoutExercise; number: number }
  | {
      kind: "superset";
      letter: string;
      exercises: WorkoutExercise[];
      restSeconds: number | null;
    };

/** Group the flat exercise list into contiguous superset runs + singles. */
function buildPlan(exercises: readonly WorkoutExercise[]): PlanBlock[] {
  const sorted = [...exercises].sort((a, b) => a.sortOrder - b.sortOrder);
  const blocks: PlanBlock[] = [];
  let singleNo = 0;
  let supersetNo = 0;
  let i = 0;
  while (i < sorted.length) {
    const ex = sorted[i];
    if (ex.supersetGroup === null) {
      blocks.push({ kind: "single", exercise: ex, number: ++singleNo });
      i += 1;
      continue;
    }
    // Gather the contiguous run sharing this superset group.
    const group = ex.supersetGroup;
    const members: WorkoutExercise[] = [];
    while (i < sorted.length && sorted[i].supersetGroup === group) {
      members.push(sorted[i]);
      i += 1;
    }
    if (members.length === 1) {
      // A lone superset member renders as a plain single (mirrors the
      // creator's auto-ungroup so a solo group never shows a connector).
      blocks.push({ kind: "single", exercise: members[0], number: ++singleNo });
    } else {
      blocks.push({
        kind: "superset",
        letter: SUPERSET_LETTERS[supersetNo] ?? `${supersetNo + 1}`,
        exercises: members,
        restSeconds: members[0].restSeconds,
      });
      supersetNo += 1;
    }
  }
  return blocks;
}

function repsLabel(ex: WorkoutExercise): string {
  const sets = ex.targetSets ?? 0;
  const reps =
    ex.targetRepsMin === ex.targetRepsMax
      ? `${ex.targetRepsMin}`
      : `${ex.targetRepsMin}–${ex.targetRepsMax}`;
  return `${sets} sets × ${reps} reps`;
}

export function WorkoutDetailPresenter({
  workout,
  history,
  isHistoryLoading,
  muscles,
  equipmentLabel,
  isOwner,
  isLoading,
  error,
  weightUnit = "kg",
  onClose,
  onEdit,
  onStartWorkout,
  onExercisePress,
}: WorkoutDetailPresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.iconButton}
          testID="workout-detail-back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {workout?.name ?? "Workout"}
        </Text>
        {workout && isOwner ? (
          <TouchableOpacity
            onPress={onEdit}
            style={styles.iconButton}
            testID="workout-detail-edit"
          >
            <Ionicons
              name="create-outline"
              size={22}
              color={Colors.primary.DEFAULT}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {isLoading && !workout ? (
        <View style={styles.loadingContainer} testID="workout-detail-loading">
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading workout details...</Text>
        </View>
      ) : error && !workout ? (
        <View style={styles.errorContainer} testID="workout-detail-error">
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error.DEFAULT}
          />
          <Text style={styles.errorTitle}>Failed to load workout</Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
        </View>
      ) : workout ? (
        <>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <HeroCard
              workout={workout}
              muscles={muscles}
              equipmentLabel={equipmentLabel}
            />

            <HistoryBlock
              history={history}
              isLoading={isHistoryLoading}
              weightUnit={weightUnit}
            />

            <PlanSection
              exercises={workout.exercises}
              onExercisePress={onExercisePress}
            />

            {isOwner && (
              <View style={styles.ownerNote}>
                <Ionicons
                  name="information-circle-outline"
                  size={14}
                  color={Colors.text.tertiary}
                />
                <Text style={styles.ownerNoteText}>
                  You created this workout · tap edit to change sets, supersets
                  or order.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => onStartWorkout(workout.id)}
              testID="workout-detail-start"
            >
              <Ionicons name="play" size={18} color={Colors.text.primary} />
              <Text style={styles.startButtonText}>Start workout</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

function HeroCard({
  workout,
  muscles,
  equipmentLabel,
}: {
  workout: Workout;
  muscles: readonly string[];
  equipmentLabel: string | null;
}) {
  const exerciseCount = workout.exercises.length;
  const totalSets = workout.exercises.reduce(
    (sum, we) => sum + (we.targetSets ?? 0),
    0,
  );
  const eyebrow = equipmentLabel
    ? `${equipmentLabel.toUpperCase()} · WORKOUT`
    : "WORKOUT";
  const shownMuscles = muscles.slice(0, MAX_MUSCLE_PILLS);
  const stats: readonly { value: number; unit?: string; label: string }[] = [
    { value: workout.estimatedDurationMinutes, unit: "min", label: "DURATION" },
    { value: exerciseCount, label: "EXERCISES" },
    { value: totalSets, label: "TOTAL SETS" },
  ];

  return (
    <LinearGradient
      colors={HERO_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
      testID="workout-detail-hero"
    >
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}>
          <Ionicons name="barbell" size={24} color={Colors.text.inverse} />
        </View>
        <View style={styles.heroTitleColumn}>
          <Text style={styles.heroEyebrow} testID="workout-detail-eyebrow">
            {eyebrow}
          </Text>
          <Text style={styles.heroName}>{workout.name}</Text>
        </View>
      </View>

      {workout.description ? (
        <Text style={styles.heroDescription}>{workout.description}</Text>
      ) : null}

      <View style={styles.statRow}>
        {stats.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <View style={styles.statDivider} />}
            <View style={[styles.statCell, i === 0 && styles.statCellLeading]}>
              <View style={styles.statValueRow}>
                <Text style={styles.statValue}>{s.value}</Text>
                {s.unit ? <Text style={styles.statUnit}>{s.unit}</Text> : null}
              </View>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {shownMuscles.length > 0 && (
        <View style={styles.pillRow}>
          {shownMuscles.map((m, i) => (
            <View
              key={m}
              style={[
                styles.pill,
                i === 0 ? styles.pillPrimary : styles.pillNeutral,
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  i === 0 ? styles.pillTextPrimary : styles.pillTextNeutral,
                ]}
              >
                {m}
              </Text>
            </View>
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

function HistoryBlock({
  history,
  isLoading,
  weightUnit,
}: {
  history: WorkoutHistory | null;
  isLoading: boolean;
  weightUnit: WeightUnit;
}) {
  // While the (online-direct) history fetch is in flight, render nothing so
  // the "Not done yet" line doesn't flash before real stats arrive.
  if (isLoading) return null;

  if (!history || history.completedCount <= 0) {
    return (
      <View style={styles.notDoneRow} testID="workout-detail-history-empty">
        <Ionicons name="time-outline" size={13} color={Colors.text.tertiary} />
        <Text style={styles.notDoneText}>Not done yet</Text>
      </View>
    );
  }

  const lastDone = formatRelativeDay(history.lastCompletedAt) ?? "—";
  const avgTime = formatMinutesFromSeconds(history.avgDurationSeconds) ?? "—";
  const last = history.lastSession;
  const lastDate = last ? formatShortDate(last.completedAt) : null;
  const lastMinutes = last
    ? formatMinutesFromSeconds(last.durationSeconds)
    : null;

  const cells: readonly {
    value: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    primary?: boolean;
  }[] = [
    {
      value: lastDone,
      label: "LAST DONE",
      icon: "calendar-outline",
      primary: true,
    },
    {
      value: `${history.completedCount}×`,
      label: "COMPLETED",
      icon: "checkmark",
    },
    { value: avgTime, label: "AVG TIME", icon: "timer-outline" },
  ];

  return (
    <View style={styles.historyCard} testID="workout-detail-history">
      <View style={styles.historyStatRow}>
        {cells.map((c, i) => (
          <React.Fragment key={c.label}>
            {i > 0 && <View style={styles.historyDivider} />}
            <View style={styles.historyCell}>
              <Ionicons name={c.icon} size={13} color={Colors.text.tertiary} />
              <Text
                style={[
                  styles.historyValue,
                  c.primary && styles.historyValuePrimary,
                ]}
              >
                {c.value}
              </Text>
              <Text style={styles.historyLabel}>{c.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {last && (lastDate || lastMinutes) && (
        <View style={styles.historyFooter}>
          <Ionicons
            name="trending-up"
            size={12}
            color={Colors.success.DEFAULT}
          />
          <Text style={styles.historyFooterText}>
            Last session
            {lastDate ? ` · ${lastDate}` : ""}
            {` · `}
            <Text style={styles.historyFooterVolume}>
              {formatVolumeKg(last.totalVolumeKg, weightUnit)}
            </Text>
            {lastMinutes ? ` · ${lastMinutes} min` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

function PlanSection({
  exercises,
  onExercisePress,
}: {
  exercises: readonly WorkoutExercise[];
  onExercisePress: (exerciseId: string) => void;
}) {
  const blocks = buildPlan(exercises);
  return (
    <View style={styles.planSection}>
      <View style={styles.planHeader}>
        <Text style={styles.planEyebrow}>THE PLAN</Text>
        <Text style={styles.planCount}>{blocks.length} blocks</Text>
      </View>
      <View style={styles.planList}>
        {blocks.map((block, idx) =>
          block.kind === "single" ? (
            <SingleExerciseRow
              key={block.exercise.id}
              exercise={block.exercise}
              number={block.number}
              onPress={() => onExercisePress(block.exercise.exerciseId)}
            />
          ) : (
            <SupersetBlockRow
              key={`ss-${idx}`}
              letter={block.letter}
              exercises={block.exercises}
              restSeconds={block.restSeconds}
              onExercisePress={onExercisePress}
            />
          ),
        )}
      </View>
    </View>
  );
}

function SingleExerciseRow({
  exercise,
  number,
  onPress,
}: {
  exercise: WorkoutExercise;
  number: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.exerciseCard}
      onPress={onPress}
      testID={`workout-detail-exercise-${exercise.exerciseId}`}
      activeOpacity={0.85}
    >
      <View style={styles.exerciseNumberBadge}>
        <Text style={styles.exerciseNumberText}>{number}</Text>
      </View>
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>
          {exercise.exercise?.name ?? "Exercise"}
        </Text>
        <Text style={styles.exerciseDetails}>{repsLabel(exercise)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.text.tertiary} />
    </TouchableOpacity>
  );
}

function SupersetBlockRow({
  letter,
  exercises,
  restSeconds,
  onExercisePress,
}: {
  letter: string;
  exercises: readonly WorkoutExercise[];
  restSeconds: number | null;
  onExercisePress: (exerciseId: string) => void;
}) {
  return (
    <View testID={`workout-detail-superset-${letter}`}>
      {/* Top connector with centred letter pill */}
      <View style={styles.supersetConnector}>
        <View style={styles.supersetLine} />
        <View style={styles.supersetPill}>
          <Ionicons
            name="layers-outline"
            size={10}
            color={Colors.text.inverse}
          />
          <Text style={styles.supersetPillText}>SUPERSET {letter}</Text>
        </View>
        <View style={styles.supersetLine} />
      </View>

      <View style={styles.supersetMembers}>
        {exercises.map((ex, i) => (
          <TouchableOpacity
            key={ex.id}
            style={styles.supersetMemberCard}
            onPress={() => onExercisePress(ex.exerciseId)}
            testID={`workout-detail-exercise-${ex.exerciseId}`}
            activeOpacity={0.85}
          >
            <View style={styles.supersetTagBadge}>
              <Text style={styles.supersetTagText}>
                {letter}
                {i + 1}
              </Text>
            </View>
            <View style={styles.exerciseInfo}>
              <Text style={styles.exerciseName}>
                {ex.exercise?.name ?? "Exercise"}
              </Text>
              <Text style={styles.exerciseDetails}>{repsLabel(ex)}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.text.tertiary}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Closing connector */}
      <View style={styles.supersetFooter}>
        <View style={styles.supersetLine} />
        <Text style={styles.supersetFooterText}>
          {restSeconds != null
            ? `back-to-back · ${restSeconds}s rest after`
            : "back-to-back"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  iconButton: {
    padding: Spacing.sm,
    minWidth: 40,
  },
  headerTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
    color: Colors.text.primary,
  },
  headerSpacer: {
    width: 40,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: 104,
    gap: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body2,
    textAlign: "center",
    color: Colors.text.secondary,
  },
  // HERO
  hero: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary.DEFAULT + "44",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.primary.DEFAULT,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.glow,
  },
  heroTitleColumn: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: Colors.primary.DEFAULT,
    marginBottom: 3,
  },
  heroName: {
    ...Typography.h2,
    color: Colors.text.primary,
  },
  heroDescription: {
    ...Typography.body2,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.text.secondary,
    marginTop: 12,
  },
  statRow: {
    flexDirection: "row",
    marginTop: 14,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.surface.border,
    marginVertical: 2,
  },
  statCell: {
    flex: 1,
    alignItems: "center",
  },
  statCellLeading: {
    alignItems: "flex-start",
    paddingLeft: 2,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },
  statValue: {
    fontSize: 21,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  statUnit: {
    fontSize: 11,
    color: Colors.text.tertiary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: Colors.text.tertiary,
    marginTop: 3,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 14,
  },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  pillPrimary: {
    backgroundColor: Colors.primary.DEFAULT + "22",
    borderColor: Colors.primary.DEFAULT + "55",
  },
  pillNeutral: {
    backgroundColor: Colors.surface.tertiary,
    borderColor: Colors.surface.border,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  pillTextPrimary: {
    color: Colors.primary.DEFAULT,
  },
  pillTextNeutral: {
    color: Colors.text.secondary,
  },
  // HISTORY
  historyCard: {
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface.primary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    overflow: "hidden",
  },
  historyStatRow: {
    flexDirection: "row",
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  historyDivider: {
    width: 1,
    backgroundColor: Colors.surface.border,
    marginVertical: 4,
  },
  historyCell: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  historyValue: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  historyValuePrimary: {
    color: Colors.primary.DEFAULT,
  },
  historyLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.text.tertiary,
  },
  historyFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
    backgroundColor: Colors.background.tertiary,
  },
  historyFooterText: {
    ...Typography.body2,
    fontSize: 11,
    color: Colors.text.tertiary,
    flex: 1,
  },
  historyFooterVolume: {
    color: Colors.text.secondary,
    fontWeight: "600",
  },
  notDoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  notDoneText: {
    ...Typography.body2,
    fontSize: 11.5,
    color: Colors.text.tertiary,
  },
  // PLAN
  planSection: {
    marginTop: 2,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  planEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: Colors.text.tertiary,
  },
  planCount: {
    fontSize: 11,
    color: Colors.text.tertiary,
  },
  planList: {
    gap: 12,
  },
  exerciseCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    padding: 12,
  },
  exerciseNumberBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseNumberText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  exerciseInfo: {
    flex: 1,
    minWidth: 0,
  },
  exerciseName: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  exerciseDetails: {
    ...Typography.body2,
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  // SUPERSET
  supersetConnector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    marginBottom: 7,
  },
  supersetLine: {
    flex: 1,
    height: 2,
    borderRadius: 2,
    backgroundColor: Colors.primary.DEFAULT,
    opacity: 0.5,
  },
  supersetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary.DEFAULT,
  },
  supersetPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.text.inverse,
  },
  supersetMembers: {
    gap: 8,
  },
  supersetMemberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary.DEFAULT,
    padding: 12,
  },
  supersetTagBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 7,
    paddingHorizontal: 6,
    backgroundColor: Colors.primary.DEFAULT,
    alignItems: "center",
    justifyContent: "center",
  },
  supersetTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text.inverse,
  },
  supersetFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  supersetFooterText: {
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  // OWNER NOTE + FOOTER
  ownerNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  ownerNoteText: {
    ...Typography.body2,
    fontSize: 11.5,
    color: Colors.text.tertiary,
    flex: 1,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: Colors.background.primary,
  },
  startButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    ...Shadows.electric,
  },
  startButtonText: {
    ...Typography.button,
    color: Colors.text.primary,
  },
});
