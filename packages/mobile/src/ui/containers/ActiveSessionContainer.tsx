/**
 * ActiveSessionContainer — owns session state + mutations for the
 * `/(app)/session` modal screen. (M3, Stories 002 + 004 + 005 + 009.)
 *
 * On mount:
 *   - If `?sessionId=` is present, resume from SQLite (no work — the
 *     screen renders whatever's cached).
 *   - If `?workoutId=` is present and no active session exists, kick
 *     off `StartSessionCommand({ workout })`. If `getWorkout(id)` is
 *     still loading the screen waits with a spinner.
 *   - If neither is present, kick off `StartSessionCommand({})` for
 *     a Quick Start session.
 *
 * Mutations wrap their corresponding command and call `rereadCache`
 * (NOT `refresh` — sets only flush on session complete; M2 learning #4).
 * `useFocusEffect(rereadCache)` picks up substitution / add-exercise
 * mutations made inside the picker modal (M2 learning #5).
 *
 * Spec: specs/05-active-session/requirements.md STORY-001..005, 009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  addSupersetSetCommand,
  cancelSessionCommand,
  logSetCommand,
  removeExerciseCommand,
  setExerciseNotesCommand,
  startSessionCommand,
} from "@/application/commands/session";
import { ExerciseNotesPopover } from "@/ui/components/session/ExerciseNotesPopover";
import { renumberSets } from "@/domain/services/sessionService";
import type { Exercise } from "@/domain/models/exercise";
import type { ExerciseSet } from "@/domain/models/session";
import { ActiveSessionPresenter } from "@/ui/presenters/ActiveSessionPresenter";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useRestTimer } from "@/ui/hooks/useRestTimer";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import {
  applyPickerSelection,
  resolveLegacyExercise,
  resolveSubstituteMuscleFilter,
  type ActiveSessionPickerMode,
  type LegacyPickerRow,
} from "@/ui/containers/active-session-picker";
import { buildTemplateMap } from "@/ui/containers/active-session-template";

// Default rest seconds when the workout template doesn't carry one.
// FRONTEND_BRIEF "Out of scope" notes M6 ships the configurator; M3
// just consumes a sensible default here.
const DEFAULT_REST_SECONDS = 90;

export function ActiveSessionContainer() {
  const { storage, api } = useAdapters();
  const params = useLocalSearchParams<{
    workoutId?: string;
    sessionId?: string;
  }>();
  const requestedWorkoutId = params.workoutId ?? null;

  const { session, userId, rereadCache } = useActiveSession();

  // Stable id factory — empty deps, M2 learning #7.
  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Drain SQLite mutations on focus so picker-modal substitutions /
  // adds surface immediately (M2 learning #5).
  useFocusEffect(
    useCallback(() => {
      rereadCache();
    }, [rereadCache]),
  );

  // Workout-from-template loader. Resolution order:
  //   1. `session.workoutId` once the session is staged — keeps the
  //      template loaded for the lifetime of the session so per-set
  //      lookups (rest seconds, etc.) stay sourced from the template.
  //   2. `requestedWorkoutId` from the route param pre-start (the
  //      session hasn't been seeded yet). Once the start flow runs
  //      and the session lands, (1) takes over.
  //   3. `null` for Quick Start / unparented Quick Start sessions —
  //      no template, no rest-seconds source, callers fall back to
  //      DEFAULT_REST_SECONDS.
  // A previous version flipped workoutId → null as soon as `session`
  // was truthy, which silently emptied `detail.workout` and made
  // every per-exercise restSeconds lookup fall through to default,
  // ignoring the template value.
  const workoutId = session?.workoutId ?? requestedWorkoutId ?? null;
  const detail = useWorkout(workoutId);
  const startAttemptedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (session) {
      startAttemptedRef.current = true;
      return;
    }
    if (startAttemptedRef.current) return;

    if (workoutId) {
      // Wait for the workout payload before starting; we need the
      // exercise list to seed the session.
      if (!detail.workout) return;
      startAttemptedRef.current = true;
      const result = startSessionCommand(
        { storage, generateId, userId },
        { workout: detail.workout },
      );
      // ACTIVE_SESSION_EXISTS is handled by the resume prompt (commit
      // 9). For a direct route, we silently fall through — the existing
      // session is already in cache and the next rereadCache picks it
      // up.
      void result;
      rereadCache();
      return;
    }

    // Quick Start.
    startAttemptedRef.current = true;
    startSessionCommand({ storage, generateId, userId }, {});
    rereadCache();
  }, [
    userId,
    session,
    workoutId,
    detail.workout,
    storage,
    generateId,
    rereadCache,
  ]);

  // Rest timer is owned at the container level so the screen surface
  // can render the overlay regardless of which exercise card the user
  // is on. `userId` is guarded — useRestTimer can't run without one.
  const restTimer = useRestTimer({ userId: userId ?? "anonymous" });

  // Quick-fill bias for set 1: cross-session previous (last-workout's
  // matching set) when wired. NOT yet sourced — V2 has no equivalent
  // of legacy `user_history.recent_sets` plumbed through. Tracked as a
  // M3 follow-up; for now this map is null per exercise. SessionExercise-
  // Card derives per-set "previous" from the immediately preceding
  // sibling set's data so set 2+ shows useful chips even without the
  // cross-session source.
  const previousByExercise = useMemo(() => {
    const map: Record<string, { weightKg: number; reps: number } | null> = {};
    if (!session) return map;
    for (const ex of session.exercises) {
      map[ex.id] = null;
    }
    return map;
  }, [session]);

  // Per-exercise template metadata threaded from the workout template.
  // Drives the legacy "{N} sets × {min}-{max} reps" caption + thumbnail
  // + START NS REST button label. Quick-Start sessions land outside the
  // map and the presenter falls back to a default rest seconds.
  const templateByExercise = useMemo(
    () =>
      buildTemplateMap({
        sessionExercises: session?.exercises ?? [],
        workout: detail.workout,
        defaultRestSeconds: DEFAULT_REST_SECONDS,
      }),
    [session, detail.workout],
  );

  const onStartRest = useCallback(
    (sessionExerciseId: string) => {
      if (!session) return;
      const exercise = session.exercises.find(
        (ex) => ex.id === sessionExerciseId,
      );
      if (!exercise) return;
      const template = templateByExercise[sessionExerciseId];
      const restSeconds = template?.restSeconds ?? DEFAULT_REST_SECONDS;
      restTimer.start(restSeconds, exercise.exerciseName);
    },
    [session, templateByExercise, restTimer],
  );

  // -- Mutation wiring --------------------------------------------------

  const onLogSet = useCallback(
    (sessionExerciseId: string) => {
      if (!userId) return;
      logSetCommand({ storage, generateId, userId }, { sessionExerciseId });
      rereadCache();
    },
    [userId, storage, generateId, rereadCache],
  );

  const onLogSupersetSet = useCallback(
    (sessionExerciseIds: readonly string[]) => {
      if (!userId) return;
      addSupersetSetCommand(
        { storage, generateId, userId },
        { sessionExerciseIds },
      );
      rereadCache();
    },
    [userId, storage, generateId, rereadCache],
  );

  const onUpdateSet = useCallback(
    (
      sessionExerciseId: string,
      setId: string,
      patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
    ) => {
      if (!userId) return;
      const current = storage.getActiveSession(userId);
      if (!current) return;
      const next = {
        ...current,
        exercises: current.exercises.map((ex) =>
          ex.id === sessionExerciseId
            ? {
                ...ex,
                sets: ex.sets.map((s) =>
                  s.id === setId ? { ...s, ...patch } : s,
                ),
              }
            : ex,
        ),
      };
      storage.cacheActiveSession(userId, next);
      storage.invalidateDashboard(userId);
      rereadCache();
    },
    [userId, storage, rereadCache],
  );

  const onRemoveSet = useCallback(
    (sessionExerciseId: string, setId: string) => {
      if (!userId) return;
      const current = storage.getActiveSession(userId);
      if (!current) return;
      // Filter the removed set out, then renumber the survivors so
      // `setNumber` stays a contiguous 1..n. Without renumbering the
      // next addSetToExercise would emit a duplicate setNumber (e.g.
      // [1,2,3] → remove 2 → [1,3] → add → [1,3,3]) which corrupts
      // the bulk-record flush wire shape.
      const filtered = {
        ...current,
        exercises: current.exercises.map((ex) =>
          ex.id === sessionExerciseId
            ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) }
            : ex,
        ),
      };
      const next = renumberSets(filtered, sessionExerciseId);
      storage.cacheActiveSession(userId, next);
      storage.invalidateDashboard(userId);
      rereadCache();
    },
    [userId, storage, rereadCache],
  );

  const [pickerMode, setPickerMode] = useState<ActiveSessionPickerMode>(null);
  const [notesEditingId, setNotesEditingId] = useState<string | null>(null);

  const onSubstitute = useCallback((sessionExerciseId: string) => {
    setPickerMode({
      kind: "substitute",
      oldSessionExerciseId: sessionExerciseId,
    });
  }, []);

  // The source exercise's primary muscle groups drive the substitute
  // picker's filter (Story-004 AC). Logic lives in
  // `active-session-picker.ts` so the substitute / no-source / no-
  // cache fallbacks are unit-testable without rendering.
  const substituteMuscleFilter = useMemo<readonly string[] | undefined>(
    () =>
      resolveSubstituteMuscleFilter(
        pickerMode,
        session?.exercises ?? [],
        storage,
      ),
    [pickerMode, session, storage],
  );

  const onOpenNotes = useCallback((sessionExerciseId: string) => {
    setNotesEditingId(sessionExerciseId);
  }, []);

  const onCloseNotes = useCallback(() => setNotesEditingId(null), []);

  const onSaveNotes = useCallback(
    (notes: string) => {
      if (!userId || !notesEditingId) {
        setNotesEditingId(null);
        return;
      }
      setExerciseNotesCommand(
        { storage, userId },
        { sessionExerciseId: notesEditingId, notes },
      );
      rereadCache();
      setNotesEditingId(null);
    },
    [userId, notesEditingId, storage, rereadCache],
  );

  const onRemoveExercise = useCallback(
    (sessionExerciseId: string) => {
      if (!userId) return;
      Alert.alert(
        "Remove exercise",
        "Are you sure? Logged sets on this exercise will be lost.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              removeExerciseCommand({ storage, userId }, { sessionExerciseId });
              rereadCache();
            },
          },
        ],
      );
    },
    [userId, storage, rereadCache],
  );

  const onAddExercise = useCallback(() => {
    setPickerMode({ kind: "add" });
  }, []);

  const onClosePicker = useCallback(() => setPickerMode(null), []);

  // Resolve a legacy picker row → canonical Exercise via the cached
  // exercise library. Logic lives in `active-session-picker.ts` so
  // the cache-miss / cache-hit branches are unit-tested without
  // mounting the AddExercisePopover modal tree.
  const resolveExercise = useCallback(
    (row: LegacyPickerRow): Exercise | null =>
      resolveLegacyExercise(storage, api, row),
    [storage, api],
  );

  const onPickerAddExercises = useCallback(
    (rows: LegacyPickerRow[]) => {
      if (!userId) {
        setPickerMode(null);
        return;
      }
      applyPickerSelection({
        rows,
        mode: pickerMode,
        resolveExercise,
        storage,
        generateId,
        userId,
        onAfter: rereadCache,
      });
      setPickerMode(null);
    },
    [userId, pickerMode, resolveExercise, storage, generateId, rereadCache],
  );

  // Superset add not surfaced in the active-session flow — supersets
  // come from the workout template; mid-session group changes are
  // M11 polish per BRIEF.md "Out of scope".
  const onPickerAddSuperset = useCallback(
    (rows: LegacyPickerRow[]) => onPickerAddExercises(rows),
    [onPickerAddExercises],
  );

  const onTapExercise = useCallback((exerciseId: string) => {
    // Stacked navigation — exercise detail pushes on top, session
    // sits underneath, back returns here. M2 learning #11.
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  const onClose = useCallback(() => {
    router.back();
  }, []);

  const onFinish = useCallback(() => {
    // Tap Complete → rating screen captures 1-10 difficulty + notes
    // → submit fires completeSessionCommand → replaces with summary.
    // Matches legacy ActiveWorkoutModal flow:
    //   handleCompleteWorkout → setCurrentView('rating')
    //   handleRatingSubmit    → recordWorkout → setCurrentView('summary')
    router.push("/(app)/session/rate" as never);
  }, []);

  const onDiscard = useCallback(() => {
    // Native Alert.alert matching legacy `ActiveWorkoutModal.handleDiscardWorkout`
    // (persistence-mobile/components/workouts/ActiveWorkoutModal.tsx:514).
    // Confirm first; on Discard, fire cancelSessionCommand (queues the
    // bulk-record cancellation flush) and dismiss the modal stack.
    if (!userId) return;
    Alert.alert(
      "Cancel Workout",
      "Are you sure you want to discard this workout? All progress will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            cancelSessionCommand({ storage, userId });
            router.dismissAll();
          },
        },
      ],
    );
  }, [userId, storage]);

  // Existing-exercise ids are used by the picker to disable "Add"
  // for already-in-session entries. For substitute we don't disable —
  // user might pick a different variant of the same exercise.
  const existingExerciseIds = useMemo(() => {
    if (!session) return [];
    if (pickerMode?.kind === "substitute") return [];
    return session.exercises
      .filter((ex) => !ex.isSubstituted)
      .map((ex) => ex.exerciseId);
  }, [session, pickerMode]);

  // Loading / error gates --------------------------------------------------

  if (!userId) {
    return null;
  }
  if (!session) {
    // Either start command is in-flight (workout payload still loading)
    // or it's a no-op. Render the empty presenter shell rather than a
    // blank screen.
    return null;
  }

  return (
    <>
      <ActiveSessionPresenter
        sessionName={session.name}
        startedAt={session.startedAt}
        exercises={session.exercises}
        previousByExercise={previousByExercise}
        templateByExercise={templateByExercise}
        restTimer={{
          isActive: restTimer.isActive,
          remainingSeconds: restTimer.remainingSeconds,
          totalSeconds: restTimer.totalSeconds,
          progress: restTimer.progress,
          onSkip: restTimer.skip,
          onExtend: restTimer.extend,
          onDismiss: restTimer.dismiss,
        }}
        onClose={onClose}
        onLogSet={onLogSet}
        onLogSupersetSet={onLogSupersetSet}
        onUpdateSet={onUpdateSet}
        onRemoveSet={onRemoveSet}
        onOpenNotes={onOpenNotes}
        onSubstitute={onSubstitute}
        onRemoveExercise={onRemoveExercise}
        onTapExercise={onTapExercise}
        onAddExercise={onAddExercise}
        onStartRest={onStartRest}
        onDiscard={onDiscard}
        onFinish={onFinish}
      />

      <AddExercisePopover
        visible={pickerMode != null}
        onClose={onClosePicker}
        onAddExercises={onPickerAddExercises}
        onAddSuperset={onPickerAddSuperset}
        existingExerciseIds={existingExerciseIds}
        filterByPrimaryMuscleGroups={substituteMuscleFilter}
      />

      <ExerciseNotesPopover
        visible={notesEditingId != null}
        exerciseName={
          (notesEditingId &&
            session.exercises.find((ex) => ex.id === notesEditingId)
              ?.exerciseName) ||
          ""
        }
        initialNotes={
          (notesEditingId &&
            session.exercises.find((ex) => ex.id === notesEditingId)?.notes) ||
          ""
        }
        onSave={onSaveNotes}
        onCancel={onCloseNotes}
      />
    </>
  );
}
