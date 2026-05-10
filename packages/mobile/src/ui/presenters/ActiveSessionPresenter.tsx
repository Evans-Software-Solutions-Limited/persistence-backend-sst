/**
 * ActiveSessionPresenter — full-screen session UI. (M3, Stories
 * 002 + 005 + 007.)
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/ActiveWorkoutScreen`
 * — vertical `ScrollView` with all exercises stacked, flush header at
 * top (no top-bar chrome), "+ Add Exercise" link below the list,
 * Discard / Complete buttons at the very bottom. Substituted exercises
 * render in place — sets stay visible and the source list mirrors what
 * gets flushed in the bulk-record payload (Story-004 AC).
 *
 * The Discard button delegates to the container, which fires a native
 * `Alert.alert` ("Cancel Workout", "Are you sure...", Cancel + Discard)
 * matching legacy `ActiveWorkoutModal.handleDiscardWorkout`. NO
 * confirmation Popover, NO routed Summary screen for discard. The
 * Summary screen is save-only.
 *
 * `RestTimerDisplay` overlays the bottom when active.
 *
 * Spec: specs/05-active-session/requirements.md STORY-002, STORY-005, STORY-007
 *       persistence-mobile/components/workouts/ActiveWorkoutScreen
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ActiveSupersetRow } from "@/ui/components/session/ActiveSupersetRow";
import { RestTimerDisplay } from "@/ui/components/session/RestTimerDisplay";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import { SessionHeader } from "@/ui/components/session/SessionHeader";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";

/**
 * Per-exercise template metadata threaded from the container's
 * `useWorkout` lookup. `restSeconds` is required (defaults to a
 * sensible global at the container if no template); the rest are
 * optional and drive the legacy "{N} sets × {min}-{max} reps" caption
 * + thumbnail when present.
 */
export type SessionExerciseTemplate = {
  imageUrl?: string;
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  restSeconds: number;
};

export type ActiveSessionPresenterProps = {
  sessionName: string;
  startedAt: string;
  exercises: SessionExercise[];
  /**
   * Cross-session "Previous" hint per `(sessionExerciseId, setNumber)`,
   * populated by the container from the local recent-sets cache. Mirrors
   * legacy `user_history.recent_sets`. Empty inner map for exercises the
   * user has never logged before — SetLogger renders an em-dash for
   * unmatched setNumbers.
   */
  previousSetsByExercise: Record<
    string,
    Record<number, { weightKg: number; reps: number }>
  >;
  /**
   * Map of `sessionExerciseId → template metadata`. Container builds it
   * from `useWorkout`; missing entries fall back to a default
   * `restSeconds` and skip the description caption.
   */
  templateByExercise: Record<string, SessionExerciseTemplate>;
  restTimer: {
    isActive: boolean;
    remainingSeconds: number;
    totalSeconds: number;
    progress: number;
    onSkip: () => void;
    onDismiss: () => void;
  };
  onLogSet: (sessionExerciseId: string) => void;
  onUpdateSet: (
    sessionExerciseId: string,
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onRemoveSet: (sessionExerciseId: string, setId: string) => void;
  onOpenNotes: (sessionExerciseId: string) => void;
  onSubstitute: (sessionExerciseId: string) => void;
  onRemoveExercise: (sessionExerciseId: string) => void;
  onTapExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
  /**
   * Add an empty set to every exercise in a superset group at the
   * same setNumber. Container delegates to `addSupersetSetCommand`
   * so paired logging stays in sync (Story-005 AC).
   */
  onLogSupersetSet: (sessionExerciseIds: readonly string[]) => void;
  /**
   * Drop the Nth set from every peer in a superset group. Container
   * delegates to `removeSupersetSetCommand` (renumbers survivors so
   * the bulk-record flush stays a contiguous 1..n).
   */
  onRemoveSupersetSet: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /**
   * Open the container-owned notes popover keyed to a set inside a
   * superset group. Title shows "Superset Set N"; the saved note is
   * written to every peer (legacy parity — per-set notes are
   * cosmetic, the storage is shared per superset).
   */
  onOpenSupersetNotes: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /**
   * Open the picker filtered for adding another exercise into the
   * given superset group (legacy "Add Exercise to Superset" link).
   */
  onAddExerciseToSuperset: (supersetGroup: number) => void;
  /**
   * Start the rest timer for the given exercise (legacy `START NS REST`
   * button). User-tap-driven — no auto-fire on set completion.
   */
  onStartRest: (sessionExerciseId: string) => void;
  onDiscard: () => void;
  onFinish: () => void;
};

const DEFAULT_TEMPLATE: SessionExerciseTemplate = { restSeconds: 90 };

type DisplayItem =
  | { kind: "exercise"; exercise: SessionExercise }
  | {
      kind: "superset";
      supersetGroup: number;
      exercises: SessionExercise[];
    };

/**
 * Group consecutive exercises sharing the same `supersetGroup` into a
 * single `superset` display item. Mirrors legacy `ActiveWorkoutScreen`
 * lines 83-113. Each `supersetGroup` is rendered exactly once even
 * if the group's exercises are interleaved with non-superset rows.
 */
function buildDisplayItems(exercises: SessionExercise[]): DisplayItem[] {
  const sorted = [...exercises].sort((a, b) => a.sortOrder - b.sortOrder);
  const usedGroups = new Set<number>();
  const items: DisplayItem[] = [];
  for (const ex of sorted) {
    const group = ex.supersetGroup;
    if (group != null) {
      if (usedGroups.has(group)) continue;
      const peers = sorted.filter(
        (candidate) => candidate.supersetGroup === group,
      );
      usedGroups.add(group);
      // A "superset" of one is rendered as a plain exercise card.
      if (peers.length < 2) {
        items.push({ kind: "exercise", exercise: ex });
        continue;
      }
      items.push({ kind: "superset", supersetGroup: group, exercises: peers });
      continue;
    }
    items.push({ kind: "exercise", exercise: ex });
  }
  return items;
}

export function ActiveSessionPresenter(props: ActiveSessionPresenterProps) {
  const orderedExercises = useMemo(
    () => [...props.exercises].sort((a, b) => a.sortOrder - b.sortOrder),
    [props.exercises],
  );
  const displayItems = useMemo(
    () => buildDisplayItems(props.exercises),
    [props.exercises],
  );

  return (
    <View style={styles.container} testID="active-session-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SessionHeader
          startedAt={props.startedAt}
          sessionName={props.sessionName}
        />
        {orderedExercises.length === 0 ? (
          <View style={styles.emptyWrap} testID="active-session-empty">
            <Text style={styles.emptyTitle}>No exercises yet</Text>
            <Text style={styles.emptyBody}>
              Add exercises from the library to start logging sets.
            </Text>
            <TouchableOpacity
              onPress={props.onAddExercise}
              style={styles.emptyAddButton}
              testID="active-session-empty-add"
              accessibilityLabel="Add exercise"
            >
              <Ionicons name="add" size={18} color={Colors.text.primary} />
              <Text style={styles.emptyAddLabel}>Add exercise</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.exercisesContainer}>
            {displayItems.map((item) => {
              if (item.kind === "exercise") {
                const ex = item.exercise;
                const template =
                  props.templateByExercise[ex.id] ?? DEFAULT_TEMPLATE;
                return (
                  <SessionExerciseCard
                    key={ex.id}
                    exercise={ex}
                    previousSetsBySetNumber={
                      props.previousSetsByExercise[ex.id] ?? {}
                    }
                    exerciseImageUrl={template.imageUrl}
                    targetSets={template.targetSets}
                    targetRepsMin={template.targetRepsMin}
                    targetRepsMax={template.targetRepsMax}
                    restSeconds={template.restSeconds}
                    onLogSet={() => props.onLogSet(ex.id)}
                    onUpdateSet={(setId, patch) =>
                      props.onUpdateSet(ex.id, setId, patch)
                    }
                    onRemoveSet={(setId) => props.onRemoveSet(ex.id, setId)}
                    onOpenNotes={() => props.onOpenNotes(ex.id)}
                    onSubstitute={() => props.onSubstitute(ex.id)}
                    onRemoveExercise={() => props.onRemoveExercise(ex.id)}
                    onTapExercise={() => props.onTapExercise(ex.exerciseId)}
                    onStartRest={() => props.onStartRest(ex.id)}
                  />
                );
              }
              return (
                <ActiveSupersetRow
                  key={`superset-${item.supersetGroup}`}
                  supersetGroup={item.supersetGroup}
                  exercises={item.exercises}
                  previousSetsByExercise={props.previousSetsByExercise}
                  templateByExercise={props.templateByExercise}
                  onLogSupersetSet={props.onLogSupersetSet}
                  onUpdateSet={props.onUpdateSet}
                  onRemoveSupersetSet={props.onRemoveSupersetSet}
                  onStartRest={props.onStartRest}
                  onSubstitute={props.onSubstitute}
                  onRemoveExercise={props.onRemoveExercise}
                  onOpenSupersetNotes={props.onOpenSupersetNotes}
                  onAddExerciseToSuperset={props.onAddExerciseToSuperset}
                />
              );
            })}
          </View>
        )}

        {orderedExercises.length > 0 && (
          <View
            style={styles.addExerciseSection}
            testID="active-session-add-exercise-row"
          >
            <View style={styles.divider} />
            <TouchableOpacity
              onPress={props.onAddExercise}
              style={styles.addExerciseLink}
              testID="active-session-add-exercise"
              accessibilityLabel="Add exercise"
            >
              <Ionicons
                name="add-circle-outline"
                size={20}
                color={Colors.primary.DEFAULT}
              />
              <Text style={styles.addExerciseText}>Add Exercise</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={styles.discardButton}
            onPress={props.onDiscard}
            testID="active-session-discard"
            accessibilityLabel="Discard session"
          >
            <Ionicons
              name="trash-outline"
              size={20}
              color={Colors.error.DEFAULT}
            />
            <Text style={styles.discardButtonText}>Discard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.completeButton}
            onPress={props.onFinish}
            testID="active-session-finish"
            accessibilityLabel="Complete session"
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={20}
              color={Colors.text.primary}
            />
            <Text style={styles.completeButtonText}>Complete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <RestTimerDisplay
        isActive={props.restTimer.isActive}
        remainingSeconds={props.restTimer.remainingSeconds}
        totalSeconds={props.restTimer.totalSeconds}
        progress={props.restTimer.progress}
        onSkip={props.restTimer.onSkip}
        onDismiss={props.restTimer.onDismiss}
      />
    </View>
  );
}

// Styles ported from legacy ActiveWorkoutScreen — same paddings,
// borders, button geometry. Workouts-legacy theme keeps the colour
// palette identical to the V1 app.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.md,
  },
  exercisesContainer: {
    gap: Spacing.md,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    ...Typography.body2,
    color: Colors.text.secondary,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary.DEFAULT,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  emptyAddLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  addExerciseSection: {
    marginVertical: Spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.surface.border,
    marginBottom: Spacing.md,
  },
  addExerciseLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  addExerciseText: {
    ...Typography.body1,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },
  actionButtonsContainer: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  discardButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT,
  },
  discardButtonText: {
    ...Typography.body1,
    color: Colors.error.DEFAULT,
    fontWeight: "600",
  },
  completeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: 12,
  },
  completeButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
