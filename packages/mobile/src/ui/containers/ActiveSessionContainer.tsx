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
  removeSupersetSetCommand,
  setExerciseNotesCommand,
  startSessionCommand,
} from "@/application/commands/session";
import { ExerciseNotesPopover } from "@/ui/components/session/ExerciseNotesPopover";
import { renumberSets } from "@/domain/services/sessionService";
import type { Exercise } from "@/domain/models/exercise";
import type { ExerciseSet } from "@/domain/models/session";
import { ActiveSessionPresenter } from "@/ui/presenters/ActiveSessionPresenter";
import { formatBarElapsed } from "@/ui/presenters/ActiveWorkoutBarPresenter";
import { EndConfirmDialogPresenter } from "@/ui/presenters/EndConfirmDialogPresenter";
import {
  activeWorkoutElapsedSeconds,
  pointerFromSession,
  useActiveWorkout,
} from "@/state/active-workout";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useRestTimer } from "@/ui/hooks/useRestTimer";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import { AddExerciseToSupersetPopover } from "@/ui/components/workouts/AddExerciseToSupersetPopover";
import { SwapExercisePopover } from "@/ui/components/workouts/SwapExercisePopover";
import {
  applyPickerSelection,
  resolvePickerExercise,
  resolveSubstituteMuscleFilter,
  resolveSubstituteMuscleLabels,
  type ActiveSessionPickerMode,
  type PickerExerciseRow,
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
    // M18 coach Start-live — present only when a coach opens a client's session
    // from the Client Detail "Upcoming sessions" card. Seeds the trainer banner
    // + on-behalf record routing (carried on the useActiveWorkout pointer).
    clientId?: string;
    clientName?: string;
    clientInitials?: string;
  }>();
  const requestedWorkoutId = params.workoutId ?? null;

  const { session, userId, rereadCache } = useActiveSession();

  // Coach on-behalf context for the trainer banner (STORY-004). Sourced from
  // the UI-state slice; undefined until M8 (`10-trainer-features`) seeds it via
  // the on-behalf start flow → no banner for athletes today.
  const withClient = useActiveWorkout((s) => s.active?.withClient);
  const retroactive = useActiveWorkout((s) => s.active?.retroactive);

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
      // Coach Start-live (M18): seed the on-behalf client context onto the
      // useActiveWorkout pointer so the trainer banner renders and the finalize
      // path routes the flush to the on-behalf record endpoint. `start()`
      // persists the pointer (incl. withClient) to AsyncStorage, so the coach
      // context survives a force-quit → rehydrate. The `result.ok` guard is
      // both type-narrowing (for `result.value`) and defensive — the outer
      // `if (session) return` above already subsumes the existing-session case,
      // so a NEW session is created here in practice.
      if (params.clientId && result.ok) {
        useActiveWorkout.getState().start(
          pointerFromSession(result.value, {
            withClient: {
              id: params.clientId,
              name: params.clientName ?? "",
              initials: params.clientInitials ?? "",
            },
            retroactive: false,
          }),
        );
      }
      // ACTIVE_SESSION_EXISTS is otherwise handled by the resume prompt
      // (commit 9). For a direct route, we silently fall through — the existing
      // session is already in cache and the next rereadCache picks it up.
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
    params.clientId,
    params.clientName,
    params.clientInitials,
  ]);

  // Rest timer is owned at the container level so the screen surface
  // can render the overlay regardless of which exercise card the user
  // is on. `userId` is guarded — useRestTimer can't run without one.
  const restTimer = useRestTimer({ userId: userId ?? "anonymous" });

  // Cross-session "Previous" hint per (sessionExerciseId, setNumber),
  // sourced from the local recent-sets cache (1A.4). Mirrors legacy
  // `user_history.recent_sets`. Empty map for exercises the user has
  // never logged before — SetLogger renders an em-dash in that case.
  const previousSetsByExercise = useMemo(() => {
    const map: Record<
      string,
      Record<number, { weightKg: number; reps: number }>
    > = {};
    if (!session || !userId) return map;
    const exerciseIds = session.exercises.map((ex) => ex.exerciseId);
    if (exerciseIds.length === 0) return map;
    const recent = storage.getRecentSetsByExercise(userId, exerciseIds);
    for (const ex of session.exercises) {
      map[ex.id] = recent[ex.exerciseId] ?? {};
    }
    return map;
  }, [session, userId, storage]);

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
      // Match the update / remove paths below: any active-session
      // mutation invalidates the dashboard so the workouts-this-month
      // tile + recent-activity update immediately on the next focus.
      // Without this, logging a set didn't flip the dashboard cache
      // and Home would show pre-session counts until the next manual
      // refresh.
      storage.invalidateDashboard(userId);
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
      storage.invalidateDashboard(userId);
      rereadCache();
    },
    [userId, storage, generateId, rereadCache],
  );

  const onRemoveSupersetSet = useCallback(
    (sessionExerciseIds: readonly string[], setNumber: number) => {
      if (!userId) return;
      removeSupersetSetCommand(
        { storage, userId },
        { sessionExerciseIds, setNumber },
      );
      rereadCache();
    },
    [userId, storage, rereadCache],
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

  // The notes popover serves two flavours:
  //   - { kind: "exercise" } — single exercise's notes (legacy
  //     "Exercise Notes" title, writes to that one row).
  //   - { kind: "superset" } — opened from a SET N row inside an
  //     ActiveSupersetRow. Title is "Superset Set N"; the saved note
  //     is written to every peer in the group (legacy parity — per-set
  //     notes are cosmetic, the storage is shared per superset).
  // Lifted to the container so a single ExerciseNotesPopover instance
  // serves both flavours and there's no second popover competing in
  // the modal stack.
  type NotesTarget =
    | { kind: "exercise"; sessionExerciseId: string }
    | {
        kind: "superset";
        sessionExerciseIds: readonly string[];
        setNumber: number;
      };
  const [notesTarget, setNotesTarget] = useState<NotesTarget | null>(null);

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

  // Display labels for the muscle filter — surfaced as a chip in the
  // SwapExercisePopover chrome so the user sees WHY the list is
  // narrowed. Resolved separately from the UUID filter so the chip
  // can render even when the UUID set is non-empty but unlabeled.
  const substituteMuscleLabels = useMemo<readonly string[] | undefined>(
    () =>
      resolveSubstituteMuscleLabels(
        pickerMode,
        session?.exercises ?? [],
        storage,
      ),
    [pickerMode, session, storage],
  );

  const onOpenNotes = useCallback((sessionExerciseId: string) => {
    setNotesTarget({ kind: "exercise", sessionExerciseId });
  }, []);

  const onOpenSupersetNotes = useCallback(
    (sessionExerciseIds: readonly string[], setNumber: number) => {
      setNotesTarget({ kind: "superset", sessionExerciseIds, setNumber });
    },
    [],
  );

  const onCloseNotes = useCallback(() => setNotesTarget(null), []);

  const onSaveNotes = useCallback(
    (notes: string) => {
      if (!userId || !notesTarget) {
        setNotesTarget(null);
        return;
      }
      if (notesTarget.kind === "exercise") {
        setExerciseNotesCommand(
          { storage, userId },
          { sessionExerciseId: notesTarget.sessionExerciseId, notes },
        );
      } else {
        // Superset: write the note to every peer (legacy shares notes
        // across the group; the popover title is just cosmetic).
        for (const id of notesTarget.sessionExerciseIds) {
          setExerciseNotesCommand(
            { storage, userId },
            { sessionExerciseId: id, notes },
          );
        }
      }
      rereadCache();
      setNotesTarget(null);
    },
    [userId, notesTarget, storage, rereadCache],
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

  const onAddExerciseToSuperset = useCallback((supersetGroup: number) => {
    setPickerMode({ kind: "add-to-superset", supersetGroup });
  }, []);

  const onClosePicker = useCallback(() => setPickerMode(null), []);

  // Resolve a legacy picker row → canonical Exercise via the cached
  // exercise library. Logic lives in `active-session-picker.ts` so
  // the cache-miss / cache-hit branches are unit-tested without
  // mounting the AddExercisePopover modal tree.
  const resolveExercise = useCallback(
    (row: PickerExerciseRow): Exercise | null =>
      resolvePickerExercise(storage, api, row),
    [storage, api],
  );

  const onPickerAddExercises = useCallback(
    (rows: PickerExerciseRow[]) => {
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

  // "Superset" CTA on the multi-select picker — group every picked row
  // under a fresh supersetGroup number rather than treating them as
  // independent plain adds. Routes through `applyPickerSelection` with
  // an explicit `create-superset` mode so the dispatcher reads the
  // session and allocates `max(existing supersetGroups) + 1` atomically
  // with the addExerciseCommand calls that follow. Substitute mode
  // doesn't surface this CTA (the popover's superset button is gated
  // on hasAtLeastTwo selections), so we don't need a guard here.
  const onPickerAddSuperset = useCallback(
    (rows: PickerExerciseRow[]) => {
      if (!userId) {
        setPickerMode(null);
        return;
      }
      applyPickerSelection({
        rows,
        mode: { kind: "create-superset" },
        resolveExercise,
        storage,
        generateId,
        userId,
        onAfter: rereadCache,
      });
      setPickerMode(null);
    },
    [userId, resolveExercise, storage, generateId, rereadCache],
  );

  const onTapExercise = useCallback((exerciseId: string) => {
    // Stacked navigation — exercise detail pushes on top, session
    // sits underneath, back returns here. M2 learning #11.
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  const onMinimize = useCallback(() => {
    // Collapse to the floating <ActiveWorkoutBar> (STORY-002 AC 2.4 /
    // STORY-006). Dismiss the session modal — the route segment leaves
    // "session" and <ActiveWorkoutOverlay> re-shows the bar. The session is
    // NOT cancelled; it stays live in SQLite (the existence authority), so
    // tapping the bar re-pushes this screen with the in-progress sets intact.
    router.dismiss();
  }, []);

  const onFinish = useCallback(() => {
    // Tap Complete → rating screen captures 1-10 difficulty + notes
    // → submit fires completeSessionCommand → replaces with summary.
    // Matches legacy ActiveWorkoutModal flow:
    //   handleCompleteWorkout → setCurrentView('rating')
    //   handleRatingSubmit    → recordWorkout → setCurrentView('summary')
    //
    // Legacy parity gate: `ActiveWorkoutModal.handleCompleteWorkout`
    // (persistence-mobile lines 535-557) refuses to advance to the
    // rating screen if no set has both weight and reps logged. Same
    // "set has data → set is logged" predicate the bulk-record
    // payload uses to filter non-empty sets at finalize time. Without
    // this gate the user can tap Complete on an empty session, Submit
    // on rating, and record a 0-set workout to the server.
    if (!session) return;
    const hasLoggedSet = session.exercises.some((ex) =>
      ex.sets.some((s) => s.weightKg != null && s.reps != null),
    );
    if (!hasLoggedSet) {
      Alert.alert(
        "Add a set first",
        "Log weight + reps on at least one set before completing the workout.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    router.push("/(app)/session/rate" as never);
  }, [session]);

  // 05.4: the header "End" pill opens the styled <EndConfirmDialogPresenter>
  // (replacing the legacy Alert.alert). Confirming fires cancelSessionCommand
  // (queues the bulk-record cancellation flush) and dismisses the modal stack.
  const [endConfirmVisible, setEndConfirmVisible] = useState(false);

  const onDiscard = useCallback(() => {
    setEndConfirmVisible(true);
  }, []);

  const onConfirmEnd = useCallback(() => {
    setEndConfirmVisible(false);
    if (!userId) return;
    // Coach Start-live: a discarded client session records (cancelled) on the
    // client's behalf so the write stays scoped to the client + audited.
    const onBehalfClientId =
      useActiveWorkout.getState().active?.withClient?.id ?? null;
    cancelSessionCommand({ storage, userId }, { onBehalfClientId });
    // Clear the UI-state slice too (Bug fix, Inspector Brad 🟡) — match the
    // overlay's end path. Without this, slice.active + the AsyncStorage pointer
    // dangle until the next launch's orphan reconciliation; and a stale
    // withClient/retroactive (read at lines 81-82) could leak into a future
    // session once M8 wires start() to populate them.
    void useActiveWorkout.getState().end();
    router.dismissAll();
  }, [userId, storage]);

  // Existing-exercise ids gate every picker (Add, Add-to-Superset,
  // Swap) — Brad's rule after the in-place swap fix landed: no
  // duplicates anywhere in the active session. The picker disables
  // these rows in the list so the user can't pick them; the
  // duplicate-guard inside `addExerciseToSession` /
  // `substituteExercise` defends the same invariant under cache-
  // reread races.
  // Substituted rows (legacy stale-row carryover from pre-2026-05
  // sessions) are skipped — they no longer represent an active
  // exercise and the user might legitimately want to re-add what
  // they swapped away from.
  const existingExerciseIds = useMemo(() => {
    if (!session) return [];
    return session.exercises
      .filter((ex) => !ex.isSubstituted)
      .map((ex) => ex.exerciseId);
  }, [session]);

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
        previousSetsByExercise={previousSetsByExercise}
        templateByExercise={templateByExercise}
        restTimer={{
          isActive: restTimer.isActive,
          remainingSeconds: restTimer.remainingSeconds,
          totalSeconds: restTimer.totalSeconds,
          progress: restTimer.progress,
          onSkip: restTimer.skip,
          onDismiss: restTimer.dismiss,
        }}
        onLogSet={onLogSet}
        onLogSupersetSet={onLogSupersetSet}
        onRemoveSupersetSet={onRemoveSupersetSet}
        onUpdateSet={onUpdateSet}
        onRemoveSet={onRemoveSet}
        onOpenNotes={onOpenNotes}
        onOpenSupersetNotes={onOpenSupersetNotes}
        onSubstitute={onSubstitute}
        onRemoveExercise={onRemoveExercise}
        onTapExercise={onTapExercise}
        onAddExercise={onAddExercise}
        onAddExerciseToSuperset={onAddExerciseToSuperset}
        onStartRest={onStartRest}
        withClient={withClient}
        retroactive={retroactive}
        onMinimize={onMinimize}
        onDiscard={onDiscard}
        onFinish={onFinish}
      />

      {/* Picker routing — three single-purpose popovers, mounted by
          mode so the Modal stack only ever has one active:
            - `substitute` → SwapExercisePopover (single-select +
              "Swap" footer + muscle-filter chrome). Legacy parity
              with persistence-mobile/components/workouts/SwapExercisePopover.
            - `add-to-superset` → AddExerciseToSupersetPopover
              (single-select + "Add" footer, no Create CTA).
            - `add` / `create-superset` → AddExercisePopover (multi-
              select + Add/Superset footer). */}
      <AddExercisePopover
        visible={
          pickerMode != null &&
          pickerMode.kind !== "add-to-superset" &&
          pickerMode.kind !== "substitute"
        }
        onClose={onClosePicker}
        onAddExercises={onPickerAddExercises}
        onAddSuperset={onPickerAddSuperset}
        existingExerciseIds={existingExerciseIds}
      />
      <AddExerciseToSupersetPopover
        visible={pickerMode?.kind === "add-to-superset"}
        onClose={onClosePicker}
        onAddExercise={onPickerAddExercises}
        existingExerciseIds={existingExerciseIds}
      />
      <SwapExercisePopover
        visible={pickerMode?.kind === "substitute"}
        onClose={onClosePicker}
        onSwap={onPickerAddExercises}
        existingExerciseIds={existingExerciseIds}
        filterByPrimaryMuscleGroups={substituteMuscleFilter}
        filterMuscleGroupLabels={substituteMuscleLabels}
      />

      <ExerciseNotesPopover
        visible={notesTarget != null}
        exerciseName={
          notesTarget == null
            ? ""
            : notesTarget.kind === "exercise"
              ? (session.exercises.find(
                  (ex) => ex.id === notesTarget.sessionExerciseId,
                )?.exerciseName ?? "")
              : `Superset Set ${notesTarget.setNumber}`
        }
        initialNotes={
          notesTarget == null
            ? ""
            : notesTarget.kind === "exercise"
              ? (session.exercises.find(
                  (ex) => ex.id === notesTarget.sessionExerciseId,
                )?.notes ?? "")
              : (notesTarget.sessionExerciseIds
                  .map(
                    (id) => session.exercises.find((ex) => ex.id === id)?.notes,
                  )
                  .find((n) => n != null && n.trim().length > 0) ?? "")
        }
        onSave={onSaveNotes}
        onCancel={onCloseNotes}
      />

      {endConfirmVisible && (
        <EndConfirmDialogPresenter
          elapsed={formatBarElapsed(
            activeWorkoutElapsedSeconds(session.startedAt),
          )}
          onKeepGoing={() => setEndConfirmVisible(false)}
          onEnd={onConfirmEnd}
        />
      )}
    </>
  );
}
