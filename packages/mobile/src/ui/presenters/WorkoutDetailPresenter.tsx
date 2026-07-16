import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { color } from "@/ui/theme/tokens";
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
  color.$surface2,
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
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color={color.$text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {workout?.name ?? "Workout"}
        </Text>
        {workout && isOwner ? (
          <TouchableOpacity
            onPress={onEdit}
            style={styles.iconButton}
            testID="workout-detail-edit"
            accessibilityRole="button"
            accessibilityLabel="Edit workout"
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={22} color={color.$primary} />
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
            color={color.$error}
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
                  color={color.$text3}
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
              <Ionicons name="play" size={18} color={color.$text} />
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
          <Ionicons name="barbell" size={24} color={color.$bg} />
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
        <Ionicons name="time-outline" size={13} color={color.$text3} />
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
              <Ionicons name={c.icon} size={13} color={color.$text3} />
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
          <Ionicons name="trending-up" size={12} color={color.$success} />
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
      <Ionicons name="chevron-forward" size={20} color={color.$text3} />
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
          <Ionicons name="layers-outline" size={10} color={color.$bg} />
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
            <Ionicons name="chevron-forward" size={20} color={color.$text3} />
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
    backgroundColor: color.$bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  iconButton: {
    padding: 8,
    minWidth: 40,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 104,
    gap: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    color: color.$text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    textAlign: "center",
  },
  // HERO
  hero: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: color.$primary + "44",
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
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: color.$primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  heroTitleColumn: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: color.$primary,
    marginBottom: 3,
  },
  heroName: {
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 32,
    color: color.$text,
  },
  heroDescription: {
    fontWeight: "400",
    fontSize: 12.5,
    lineHeight: 19,
    color: color.$text2,
    marginTop: 12,
  },
  statRow: {
    flexDirection: "row",
    marginTop: 14,
  },
  statDivider: {
    width: 1,
    backgroundColor: color.$surface3,
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
    color: color.$text,
  },
  statUnit: {
    fontSize: 11,
    color: color.$text3,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: color.$text3,
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
    borderRadius: 9999,
    borderWidth: 1,
  },
  pillPrimary: {
    backgroundColor: color.$primary + "22",
    borderColor: color.$primary + "55",
  },
  pillNeutral: {
    backgroundColor: color.$surface3,
    borderColor: color.$surface3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  pillTextPrimary: {
    color: color.$primary,
  },
  pillTextNeutral: {
    color: color.$text2,
  },
  // HISTORY
  historyCard: {
    borderRadius: 12,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$surface3,
    overflow: "hidden",
  },
  historyStatRow: {
    flexDirection: "row",
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  historyDivider: {
    width: 1,
    backgroundColor: color.$surface3,
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
    color: color.$text,
  },
  historyValuePrimary: {
    color: color.$primary,
  },
  historyLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: color.$text3,
  },
  historyFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: color.$surface3,
    backgroundColor: color.$surface2,
  },
  historyFooterText: {
    fontWeight: "400",
    lineHeight: 20,
    fontSize: 11,
    color: color.$text3,
    flex: 1,
  },
  historyFooterVolume: {
    color: color.$text2,
    fontWeight: "600",
  },
  notDoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  notDoneText: {
    fontWeight: "400",
    lineHeight: 20,
    fontSize: 11.5,
    color: color.$text3,
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
    color: color.$text3,
  },
  planCount: {
    fontSize: 11,
    color: color.$text3,
  },
  planList: {
    gap: 12,
  },
  exerciseCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: color.$surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$surface3,
    padding: 12,
  },
  exerciseNumberBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseNumberText: {
    fontSize: 15,
    fontWeight: "600",
    color: color.$text2,
  },
  exerciseInfo: {
    flex: 1,
    minWidth: 0,
  },
  exerciseName: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  exerciseDetails: {
    fontWeight: "400",
    lineHeight: 20,
    fontSize: 12,
    color: color.$text3,
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
    backgroundColor: color.$primary,
    opacity: 0.5,
  },
  supersetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
    backgroundColor: color.$primary,
  },
  supersetPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: color.$bg,
  },
  supersetMembers: {
    gap: 8,
  },
  supersetMemberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: color.$surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$surface3,
    borderLeftWidth: 3,
    borderLeftColor: color.$primary,
    padding: 12,
  },
  supersetTagBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 7,
    paddingHorizontal: 6,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  supersetTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: color.$bg,
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
    color: color.$text3,
  },
  // OWNER NOTE + FOOTER
  ownerNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  ownerNoteText: {
    fontWeight: "400",
    lineHeight: 20,
    fontSize: 11.5,
    color: color.$text3,
    flex: 1,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: color.$bg,
  },
  startButton: {
    backgroundColor: color.$primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: color.$primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
    color: color.$text,
  },
});
