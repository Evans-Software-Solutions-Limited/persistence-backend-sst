/**
 * ActiveSupersetRow — interleaved per-setNumber view of two-or-more
 * peers sharing a `supersetGroup`. Replaces the earlier `SupersetGroupCard`
 * which stacked full per-exercise cards vertically.
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/
 * ActiveSupersetRow/ActiveSupersetRow.tsx`. For each setNumber the
 * block contains:
 *   - "SET N" header + timer + edit-notes + (trash if more than one set)
 *   - column-headers strip (Exercise / Previous / Reps / Kg)
 *   - one mini-row per peer (`ActiveSupersetExerciseRow`)
 *   - "Add Exercise to Superset" link (setNumber === 1 only)
 *
 * Bottom: a single uppercase ADD SET button. Swap + remove icons on
 * each peer are gated to setNumber === 1 (legacy parity).
 *
 * The notes popover is OWNED BY THE CONTAINER, not this row — V2
 * lifts popover state up so the same `ExerciseNotesPopover` instance
 * serves both per-exercise and per-superset notes and there is no
 * second popover instance fighting with the first. Tapping the
 * edit-notes icon for a setNumber calls `onOpenSupersetNotes(N)` and
 * the container takes it from there with the title "Superset Set N".
 *
 * Spec: persistence-mobile/components/workouts/ActiveSupersetRow
 *       specs/05-active-session/requirements.md STORY-005
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ActiveSupersetExerciseRow } from "./ActiveSupersetExerciseRow";
import {
  IconNote,
  IconPlus,
  IconTimer,
  IconTrash,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import {
  BorderRadius,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";
import type { SessionExerciseTemplate } from "@/ui/presenters/ActiveSessionPresenter";

export type ActiveSupersetRowProps = {
  supersetGroup: number;
  exercises: SessionExercise[];
  /**
   * Cross-session "Previous" hint per (sessionExerciseId, setNumber)
   * — same shape the regular SessionExerciseCard receives.
   */
  previousSetsByExercise: Record<
    string,
    Record<number, { weightKg: number; reps: number }>
  >;
  templateByExercise: Record<string, SessionExerciseTemplate>;
  /** Add row N to every peer at once (paired logging). */
  onLogSupersetSet: (sessionExerciseIds: readonly string[]) => void;
  onUpdateSet: (
    sessionExerciseId: string,
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  /** Drop the Nth set from every peer (paired removal + renumber). */
  onRemoveSupersetSet: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /** Start the rest timer using the lead peer's `restSeconds`. */
  onStartRest: (sessionExerciseId: string) => void;
  /** Open the substitute picker for a single peer. Gated to setNumber === 1. */
  onSubstitute: (sessionExerciseId: string) => void;
  /** Remove a single peer from the superset. Gated to setNumber === 1. */
  onRemoveExercise: (sessionExerciseId: string) => void;
  /** Open the container-owned notes popover, titled "Superset Set N". */
  onOpenSupersetNotes: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /** Open the picker for adding another exercise into this superset group. */
  onAddExerciseToSuperset: (supersetGroup: number) => void;
};

const DEFAULT_TEMPLATE: SessionExerciseTemplate = { restSeconds: 90 };

export function ActiveSupersetRow(props: ActiveSupersetRowProps) {
  const leadExercise = props.exercises[0];
  const leadTemplate =
    (leadExercise && props.templateByExercise[leadExercise.id]) ??
    DEFAULT_TEMPLATE;

  const repRange = useMemo(() => {
    const min = leadTemplate.targetRepsMin;
    const max = leadTemplate.targetRepsMax;
    if (min == null || max == null) return null;
    if (min === max) return `${min} reps`;
    return `${min}-${max} reps`;
  }, [leadTemplate]);

  const setNumbers = useMemo(() => {
    const maxSetsFromExercises = props.exercises.reduce(
      (max, ex) => Math.max(max, ex.sets.length),
      0,
    );
    const totalSets = Math.max(maxSetsFromExercises, 1);
    return Array.from({ length: totalSets }, (_, idx) => idx + 1);
  }, [props.exercises]);

  const exerciseIds = useMemo(
    () => props.exercises.map((ex) => ex.id),
    [props.exercises],
  );

  const supersetHasNotes = useMemo(
    () =>
      props.exercises.some(
        (ex) => ex.notes != null && ex.notes.trim().length > 0,
      ),
    [props.exercises],
  );

  return (
    <View
      style={styles.wrapper}
      testID={`superset-group-${props.supersetGroup}`}
    >
      <View style={styles.supersetConnector}>
        <View style={styles.supersetLineStart} />
        <View style={styles.supersetBadge}>
          <Text style={styles.supersetBadgeText}>
            SUPERSET OF {setNumbers.length} SET
            {setNumbers.length === 1 ? "" : "S"}
            {repRange ? ` - ${repRange.toUpperCase()}` : ""}
          </Text>
        </View>
        <View style={styles.supersetLineContinue} />
      </View>

      <View style={styles.supersetContent}>
        {setNumbers.map((setNumber) => {
          const canRemoveSet = setNumbers.length > 1;
          return (
            <View
              key={`superset-${props.supersetGroup}-set-${setNumber}`}
              style={styles.setBlock}
            >
              <View style={styles.setHeader}>
                <Text style={styles.setHeaderText}>SET {setNumber}</Text>
                <View style={styles.setHeaderActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Start rest timer for superset set ${setNumber}`}
                    onPress={() => {
                      if (leadExercise) props.onStartRest(leadExercise.id);
                    }}
                    style={styles.actionButton}
                    testID={`superset-${props.supersetGroup}-set-${setNumber}-rest`}
                  >
                    <IconTimer size={16} color={color.$primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Edit notes for superset set ${setNumber}`}
                    onPress={() =>
                      props.onOpenSupersetNotes(exerciseIds, setNumber)
                    }
                    style={styles.actionButton}
                    testID={`superset-${props.supersetGroup}-set-${setNumber}-notes`}
                  >
                    <IconNote
                      size={16}
                      color={supersetHasNotes ? color.$primary : color.$text3}
                    />
                  </TouchableOpacity>
                  {canRemoveSet && (
                    <TouchableOpacity
                      style={styles.removeSetButton}
                      onPress={() =>
                        props.onRemoveSupersetSet(exerciseIds, setNumber)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Remove set ${setNumber} from superset ${props.supersetGroup}`}
                      testID={`superset-${props.supersetGroup}-set-${setNumber}-remove`}
                    >
                      <IconTrash size={16} color={color.$error} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.columnHeaders}>
                <Text
                  style={[styles.columnHeader, styles.columnHeaderExercise]}
                >
                  Exercise
                </Text>
                <Text
                  style={[styles.columnHeader, styles.columnHeaderPrevious]}
                >
                  Previous
                </Text>
                <Text style={[styles.columnHeader, styles.columnHeaderReps]}>
                  Reps
                </Text>
                <Text style={[styles.columnHeader, styles.columnHeaderWeight]}>
                  Kg
                </Text>
              </View>

              <View style={styles.setExercises}>
                {props.exercises.map((peer) => {
                  const currentSet = peer.sets.find(
                    (s) => s.setNumber === setNumber,
                  );
                  const previousSet =
                    props.previousSetsByExercise[peer.id]?.[setNumber];
                  return (
                    <ActiveSupersetExerciseRow
                      key={`${peer.id}-${setNumber}`}
                      exerciseName={peer.exerciseName}
                      sessionExerciseId={peer.id}
                      setNumber={setNumber}
                      currentSet={currentSet}
                      previousSet={previousSet}
                      onUpdateSet={(patch) => {
                        if (currentSet)
                          props.onUpdateSet(peer.id, currentSet.id, patch);
                      }}
                      onFillPrevious={() => {
                        if (currentSet && previousSet) {
                          props.onUpdateSet(peer.id, currentSet.id, {
                            reps: previousSet.reps,
                            weightKg: previousSet.weightKg,
                          });
                        }
                      }}
                      showSwap={setNumber === 1}
                      onSwap={() => props.onSubstitute(peer.id)}
                      showRemove={setNumber === 1}
                      onRemove={() => props.onRemoveExercise(peer.id)}
                    />
                  );
                })}
              </View>

              {setNumber === 1 && (
                <View style={styles.addExerciseToSupersetContainer}>
                  <TouchableOpacity
                    onPress={() =>
                      props.onAddExerciseToSuperset(props.supersetGroup)
                    }
                    style={styles.addExerciseToSupersetButton}
                    accessibilityRole="button"
                    accessibilityLabel="Add exercise to superset"
                    testID={`superset-${props.supersetGroup}-add-exercise`}
                  >
                    <IconPlus
                      size={16}
                      color={color.$primary}
                      strokeWidth={2.5}
                    />
                    <Text style={styles.addExerciseToSupersetText}>
                      Add Exercise to Superset
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          onPress={() => props.onLogSupersetSet(exerciseIds)}
          style={styles.button}
          accessibilityRole="button"
          accessibilityHint="Add another superset set"
          testID={`superset-${props.supersetGroup}-add-set`}
        >
          <IconPlus size={16} color={color.$primary} strokeWidth={2.5} />
          <Text style={styles.buttonText}>ADD SET</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  supersetContent: {
    gap: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: color.$primary,
  },
  setBlock: {
    gap: Spacing.sm,
  },
  setHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  setHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  setHeaderText: {
    ...Typography.body1,
    color: color.$primary,
    fontWeight: "700",
  },
  actionButton: { padding: Spacing.xs },
  removeSetButton: { padding: Spacing.xs },
  setExercises: { gap: Spacing.xs },
  buttonsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginHorizontal: Spacing.sm,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  addExerciseToSupersetContainer: {
    marginTop: Spacing.md,
    marginHorizontal: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: color.$border,
  },
  addExerciseToSupersetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  addExerciseToSupersetText: {
    ...Typography.body1,
    color: color.$primary,
    fontWeight: "600",
  },
  buttonText: {
    ...Typography.caption,
    color: color.$primary,
    fontWeight: "600",
  },
  supersetConnector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
    borderLeftWidth: 2,
    // Without an explicit color, RN defaults to black — leaves a 2pt
    // black segment at the top of the rail before `supersetContent`'s
    // cyan border picks up below. Match `supersetContent.borderLeftColor`.
    borderLeftColor: color.$primary,
  },
  supersetLineStart: {
    height: 2,
    flex: 0,
    width: 0,
    backgroundColor: color.$primary,
  },
  supersetLineContinue: {
    height: 2,
    flex: 1,
    backgroundColor: color.$primary,
  },
  supersetBadge: {
    backgroundColor: color.$primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    marginHorizontal: Spacing.xs,
  },
  supersetBadgeText: {
    ...Typography.caption,
    color: color.$primaryInk,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  columnHeaders: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
    // Must match `ActiveSupersetExerciseRow.row.gap` (Spacing.sm) so
    // the four flex columns line up under their headers — same flex
    // ratios + same gap = identical column positions. Was `xs`,
    // which subtly offset every header label.
    gap: Spacing.sm,
  },
  columnHeader: {
    ...Typography.caption,
    color: color.$text3,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  columnHeaderExercise: { flex: 3 },
  // `flex: 2.5` mirrors `columnPrevious` on `ActiveSupersetExerciseRow`
  // — without it the "Previous" header collapsed to text-width while the
  // data column claimed 2.5 flex units, throwing every header off by
  // ~30% of the row width. The legacy row + header use the same flex
  // ratios; this lines them up.
  columnHeaderPrevious: { flex: 2.5, textAlign: "center" },
  columnHeaderReps: { flex: 1, textAlign: "center" },
  columnHeaderWeight: { flex: 1, textAlign: "center" },
});
