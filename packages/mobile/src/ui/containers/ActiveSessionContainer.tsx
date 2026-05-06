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
import {
  addExerciseCommand,
  completeSetCommand,
  logSetCommand,
  startSessionCommand,
  substituteExerciseCommand,
} from "@/application/commands/session";
import type { Exercise } from "@/domain/models/exercise";
import type { ExerciseSet } from "@/domain/models/session";
import { ActiveSessionPresenter } from "@/ui/presenters/ActiveSessionPresenter";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useRestTimer } from "@/ui/hooks/useRestTimer";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";

// Default rest seconds when the workout template doesn't carry one.
// FRONTEND_BRIEF "Out of scope" notes M6 ships the configurator; M3
// just consumes a sensible default here.
const DEFAULT_REST_SECONDS = 90;

type LegacyPickerRow = {
  id: string;
  name: string;
};

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

  // Workout-from-template loader for the start-from-template flow.
  const workoutId = !session && requestedWorkoutId ? requestedWorkoutId : null;
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

  // Quick-fill: in-session previous completed set (priority codified
  // in EXECUTION_PLAN § 3.5).
  const previousByExercise = useMemo(() => {
    const map: Record<string, { weightKg: number; reps: number } | null> = {};
    if (!session) return map;
    for (const ex of session.exercises) {
      const lastCompleted = [...ex.sets]
        .reverse()
        .find((s) => s.isCompleted && s.weightKg != null && s.reps != null);
      map[ex.id] =
        lastCompleted &&
        lastCompleted.weightKg != null &&
        lastCompleted.reps != null
          ? { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps }
          : null;
    }
    return map;
  }, [session]);

  // -- Mutation wiring --------------------------------------------------

  const onLogSet = useCallback(
    (sessionExerciseId: string) => {
      if (!userId) return;
      logSetCommand({ storage, generateId, userId }, { sessionExerciseId });
      rereadCache();
    },
    [userId, storage, generateId, rereadCache],
  );

  const onCompleteSet = useCallback(
    (sessionExerciseId: string, setId: string) => {
      if (!userId || !session) return;
      const result = completeSetCommand({ storage, userId }, { setId });
      rereadCache();
      // Auto-start the rest timer per Story-003 AC. Use the workout
      // template's restSeconds if known, otherwise the global default.
      // Looked up by exerciseId on the original workout payload — the
      // session itself doesn't carry restSeconds.
      if (!result.ok) return;
      const exercise = session.exercises.find(
        (ex) => ex.id === sessionExerciseId,
      );
      const restSeconds =
        detail.workout?.exercises.find(
          (we) => we.exerciseId === exercise?.exerciseId,
        )?.restSeconds ?? DEFAULT_REST_SECONDS;
      restTimer.start(restSeconds, exercise?.exerciseName);
    },
    [userId, session, storage, rereadCache, detail.workout, restTimer],
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
      const next = {
        ...current,
        exercises: current.exercises.map((ex) =>
          ex.id === sessionExerciseId
            ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) }
            : ex,
        ),
      };
      storage.cacheActiveSession(userId, next);
      storage.invalidateDashboard(userId);
      rereadCache();
    },
    [userId, storage, rereadCache],
  );

  const [pickerMode, setPickerMode] = useState<
    | { kind: "substitute"; oldSessionExerciseId: string }
    | { kind: "add" }
    | null
  >(null);

  const onSubstitute = useCallback((sessionExerciseId: string) => {
    setPickerMode({
      kind: "substitute",
      oldSessionExerciseId: sessionExerciseId,
    });
  }, []);

  const onAddExercise = useCallback(() => {
    setPickerMode({ kind: "add" });
  }, []);

  const onClosePicker = useCallback(() => setPickerMode(null), []);

  // Resolve a legacy picker row → canonical Exercise via the cached
  // exercise library. The popover hands back snake_case rows
  // (verbatim port); the commands need the V2 `Exercise` model.
  const resolveExercise = useCallback(
    (row: LegacyPickerRow): Exercise | null => {
      const cached = storage.getCachedExercise(row.id);
      if (!cached) return null;
      return api.enrichExerciseLabels(cached);
    },
    [storage, api],
  );

  const onPickerAddExercises = useCallback(
    (rows: LegacyPickerRow[]) => {
      if (!userId || rows.length === 0) {
        setPickerMode(null);
        return;
      }
      if (pickerMode?.kind === "substitute") {
        const exercise = resolveExercise(rows[0]);
        if (exercise) {
          substituteExerciseCommand(
            { storage, generateId, userId },
            {
              oldSessionExerciseId: pickerMode.oldSessionExerciseId,
              newExercise: exercise,
            },
          );
          rereadCache();
        }
      } else if (pickerMode?.kind === "add") {
        for (const row of rows) {
          const exercise = resolveExercise(row);
          if (exercise) {
            addExerciseCommand({ storage, generateId, userId }, { exercise });
          }
        }
        rereadCache();
      }
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
    router.push("/(app)/session/summary" as never);
  }, []);

  const onDiscard = useCallback(() => {
    // Commit 8 wires the cancel-session command + flush; for now
    // route to the summary screen which owns the discard confirmation
    // path. Discard from the session screen short-circuits to summary
    // with a "discard" intent flag.
    router.push("/(app)/session/summary?intent=discard" as never);
  }, []);

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
        onCompleteSet={onCompleteSet}
        onUpdateSet={onUpdateSet}
        onRemoveSet={onRemoveSet}
        onSubstitute={onSubstitute}
        onTapExercise={onTapExercise}
        onAddExercise={onAddExercise}
        onDiscard={onDiscard}
        onFinish={onFinish}
      />

      <AddExercisePopover
        visible={pickerMode != null}
        onClose={onClosePicker}
        onAddExercises={onPickerAddExercises}
        onAddSuperset={onPickerAddSuperset}
        existingExerciseIds={existingExerciseIds}
      />
    </>
  );
}
