/**
 * SessionExerciseCard — exercise header + column-header strip + list
 * of SetLogger rows + "ADD NEW SET" / "START {N}S REST" buttons. (M3,
 * Story-002 / Story-003 / Story-004.)
 *
 * 1:1 port of legacy
 * `persistence-mobile/components/workouts/ActiveExerciseRow/ActiveExerciseRow.tsx`.
 * NOT a card — the legacy row is flush in the parent ScrollView with no
 * background, padding, or shadow. The V2 ExerciseProgress pill and
 * QuickFillSuggestion banner are also dropped (legacy has neither — the
 * per-row `Previous` cell tap-to-fill in SetLogger is the only quick-fill
 * affordance).
 *
 * Spec: persistence-mobile/components/workouts/ActiveExerciseRow/ActiveExerciseRow.tsx
 */

import React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { SetLogger } from "../SetLogger";
import { styles } from "./styles";
import {
  IconDumbbell,
  IconNote,
  IconPlus,
  IconSwap,
  IconTimer,
  IconTrash,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";

export type SessionExerciseCardProps = {
  exercise: SessionExercise;
  /**
   * Cross-session "Previous" hints keyed by setNumber. Populated by the
   * container from the local recent-sets cache. An entry exists only for
   * setNumbers the user has logged before — missing setNumbers render
   * an em-dash. Mirrors legacy `previousSets[]` from user history.
   */
  previousSetsBySetNumber: Record<number, { weightKg: number; reps: number }>;
  /** Optional thumbnail URL. A barbell-outline placeholder renders when missing. */
  exerciseImageUrl?: string;
  /**
   * Workout-template metadata. The "{N} sets × {min}-{max} reps" caption
   * renders only when both `targetSets` and `targetRepsMin` are present
   * (Quick Start sessions have no template — caption hidden).
   */
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  /** Used to label the START {N}S REST button. */
  restSeconds: number;
  onLogSet: () => void;
  onUpdateSet: (
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onRemoveSet: (setId: string) => void;
  onOpenNotes: () => void;
  onSubstitute: () => void;
  onRemoveExercise: () => void;
  onTapExercise: () => void;
  onStartRest: () => void;
};

const formatRepsLabel = (
  min: number | undefined,
  max: number | undefined,
): string | null => {
  if (min == null) return null;
  if (max == null || min === max) return `${min} reps`;
  return `${min}-${max} reps`;
};

export function SessionExerciseCard(props: SessionExerciseCardProps) {
  const repsLabel = formatRepsLabel(props.targetRepsMin, props.targetRepsMax);
  const hasDescription = props.targetSets != null && repsLabel != null;
  const hasNotes =
    props.exercise.notes != null && props.exercise.notes.length > 0;

  return (
    <View
      style={styles.exerciseRow}
      testID={`session-exercise-${props.exercise.id}`}
    >
      <View style={styles.exerciseHeader}>
        {props.exerciseImageUrl ? (
          <Image
            source={{ uri: props.exerciseImageUrl }}
            style={styles.exerciseImage}
          />
        ) : (
          <View style={styles.iconTile}>
            <IconDumbbell size={14} color={color.$primary} />
          </View>
        )}

        <TouchableOpacity
          onPress={props.onTapExercise}
          style={styles.exerciseInfo}
          testID="session-exercise-tap"
          accessibilityLabel={`Open ${props.exercise.exerciseName} details`}
        >
          <View style={styles.exerciseTitleRow}>
            <Text style={styles.exerciseName} numberOfLines={2}>
              {props.exercise.exerciseName}
            </Text>
          </View>
          {hasDescription && (
            <View style={styles.exerciseTitleRow}>
              <Text style={styles.exerciseDescription} numberOfLines={2}>
                {props.targetSets} sets × {repsLabel}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.exerciseActions}>
          <TouchableOpacity
            onPress={props.onOpenNotes}
            style={styles.actionButton}
            testID="session-exercise-notes"
            accessibilityLabel={hasNotes ? "Edit notes" : "Add notes"}
          >
            <IconNote
              size={15}
              color={hasNotes ? color.$primary : color.$text3}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onSubstitute}
            style={styles.actionButton}
            testID="session-exercise-substitute"
            accessibilityLabel="Substitute exercise"
          >
            <IconSwap size={15} color={color.$text3} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onRemoveExercise}
            style={styles.actionButton}
            testID="session-exercise-remove"
            accessibilityLabel="Remove exercise"
          >
            <IconTrash size={15} color={color.$error} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.columnHeaders}>
        <Text style={[styles.columnHeader, styles.columnHeaderSet]}>SET</Text>
        <Text style={[styles.columnHeader, styles.columnHeaderPrevious]}>
          PREV
        </Text>
        <Text style={[styles.columnHeader, styles.columnHeaderReps]}>REPS</Text>
        <Text style={[styles.columnHeader, styles.columnHeaderKg]}>KG</Text>
        <View style={styles.columnHeaderSpacer} />
      </View>

      <View>
        {props.exercise.sets.map((set, idx) => {
          // Per-set "Previous" chip = the user's most recent value for
          // this setNumber on this exercise (cross-session, sourced
          // from the recent-sets cache). Mirrors legacy
          // ActiveSetRow + previousSets[] keyed on setNumber. No
          // sibling-set fallback — legacy doesn't do that either.
          const previousForSet =
            props.previousSetsBySetNumber[set.setNumber] ?? null;
          return (
            <SetLogger
              key={set.id}
              set={set}
              setNumber={idx + 1}
              previous={previousForSet}
              onChange={(patch) => props.onUpdateSet(set.id, patch)}
              onRemove={() => props.onRemoveSet(set.id)}
              onFillPrevious={() => {
                if (previousForSet) {
                  props.onUpdateSet(set.id, {
                    weightKg: previousForSet.weightKg,
                    reps: previousForSet.reps,
                  });
                }
              }}
            />
          );
        })}

        <View style={styles.buttonsContainer}>
          <TouchableOpacity
            onPress={props.onLogSet}
            style={styles.footerButton}
            testID="session-exercise-add-set"
            accessibilityLabel="Add a new set"
          >
            <IconPlus size={12} color={color.$primary} strokeWidth={2.5} />
            <Text style={styles.footerButtonText}>ADD SET</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onStartRest}
            style={styles.footerButton}
            testID="session-exercise-start-rest"
            accessibilityLabel={`Start ${props.restSeconds} second rest timer`}
          >
            <IconTimer size={12} color={color.$primary} />
            <Text style={styles.footerButtonText}>
              {props.restSeconds}S REST
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
