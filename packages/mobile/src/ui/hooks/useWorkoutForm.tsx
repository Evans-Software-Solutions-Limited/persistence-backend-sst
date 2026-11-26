import { useCallback, useMemo, useReducer, useRef } from "react";
import { reorderExercises } from "@/domain/services/workout.service";
import {
  DEFAULT_SET_COUNT,
  DEFAULT_SET_REPS,
  MAX_SETS,
  clampReps,
  deriveFromSetReps,
} from "@/domain/services/setTargets.service";

/**
 * Form-state hook for the workout creator + editor. Holds the in-flight
 * shape in legacy snake_case so the verbatim-ported `ExerciseConfigCard`
 * consumes it without a per-row view-mapping. The submit boundary
 * converts to V2 camelCase via `toCreateWorkoutInput` /
 * `toUpdateWorkoutInput` (called by the container).
 *
 * Reducer-based per FRONTEND_BRIEF § Architecture > "form reducer over
 * CreateWorkoutInput": the reducer holds the plan (supersets, ordering, the
 * PER-139 set editor). Save validates through react-hook-form with the
 * `ui/forms/workoutForms.ts` schema (PER-147 pattern, like the plan
 * builder's Save), with this state as the form's context.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-002
 *       (creator), STORY-003 (supersets), STORY-004 (editor)
 */

export type WorkoutFormExercise = {
  /** Stable UI id for keyed renders + selection. Not the server id. */
  id: string;
  exercise_id: string;
  exercise_name: string;
  sort_order: number;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
  superset_group: number | null;
  /**
   * Reps for each set (PER-139 set editor): `[10, 8, 8]`. `null` = an
   * exercise saved with only the old range (`target_sets` ×
   * `target_reps_min`–`target_reps_max`); it stays that way, and is sent
   * without `setTargets`, until a set's reps are changed. Whenever this is a
   * list, `target_sets` / `target_reps_min` / `target_reps_max` hold the
   * values derived from it (count, lowest, highest).
   */
  set_reps: number[] | null;
};

/**
 * NB: there is deliberately no `estimatedDurationMinutes` here. The creator and
 * editor expose no duration control (legacy didn't either), so the field only
 * ever held a seeded 30 that the container then sent on every create — which is
 * why every V2 workout was stored as "30 min" regardless of its contents. The
 * server now derives the estimate from the exercise plan
 * (`application/workouts/estimateDuration.ts`, a port of the legacy heuristic).
 * If a duration control is ever added, it comes back with a real UI behind it.
 */
export type WorkoutFormState = {
  name: string;
  description: string;
  visibility: "private" | "friends" | "public";
  /**
   * Does this workout show in its AUTHOR's personal "My Workouts"? Athlete
   * authoring keeps this true; coach authoring for a client defaults it false
   * (a coach-only toggle overrides). Backend column `show_in_owner_library`.
   */
  showInOwnerLibrary: boolean;
  exercises: WorkoutFormExercise[];
};

export const EMPTY_FORM_STATE: WorkoutFormState = {
  name: "",
  description: "",
  visibility: "private",
  showInOwnerLibrary: true,
  exercises: [],
};

type Action =
  | { type: "setName"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setVisibility"; value: WorkoutFormState["visibility"] }
  | { type: "setShowInOwnerLibrary"; value: boolean }
  | {
      type: "addExercises";

      exercises: any[];
      asSuperset: boolean;
      generateId: () => string;
    }
  | { type: "removeExercise"; exerciseId: string }
  | {
      type: "setExerciseField";
      exerciseId: string;
      field: string;
      value: number;
    }
  | { type: "setSetReps"; exerciseId: string; setIndex: number; reps: number }
  | { type: "addSet"; exerciseId: string }
  | { type: "removeSet"; exerciseId: string; setIndex: number }
  | { type: "sameRepsForAll"; exerciseId: string }
  | { type: "moveExercise"; exerciseId: string; direction: -1 | 1 }
  | { type: "reorderExercise"; exerciseId: string; toPosition: number }
  | { type: "reset"; state: WorkoutFormState };

function reducer(state: WorkoutFormState, action: Action): WorkoutFormState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.value };
    case "setDescription":
      return { ...state, description: action.value };
    case "setVisibility":
      return { ...state, visibility: action.value };
    case "setShowInOwnerLibrary":
      return { ...state, showInOwnerLibrary: action.value };
    case "addExercises": {
      const nextSortOrder =
        Math.max(0, ...state.exercises.map((ex) => ex.sort_order)) + 1;
      const nextSupersetGroup = action.asSuperset
        ? Math.max(0, ...state.exercises.map((ex) => ex.superset_group ?? 0)) +
          1
        : null;
      const newExercises: WorkoutFormExercise[] = action.exercises.map(
        (exercise, index) => ({
          id: action.generateId(),
          exercise_id: exercise.id,
          exercise_name: exercise.name,
          sort_order: nextSortOrder + index,
          ...withSetReps(
            Array.from({ length: DEFAULT_SET_COUNT }, () => DEFAULT_SET_REPS),
          ),
          rest_seconds: 60,
          superset_group: nextSupersetGroup,
        }),
      );
      return { ...state, exercises: [...state.exercises, ...newExercises] };
    }
    case "removeExercise": {
      const removed = state.exercises.find((ex) => ex.id === action.exerciseId);
      const supersetGroup = removed?.superset_group ?? null;
      let next = state.exercises.filter((ex) => ex.id !== action.exerciseId);
      // Ungroup orphan supersets — if only one peer remains in the
      // group after removal, clear its superset_group so it renders
      // as a standalone exercise. Mirrors STORY-002 AC 2.7.
      if (supersetGroup !== null) {
        const remaining = next.filter(
          (ex) => ex.superset_group === supersetGroup,
        );
        if (remaining.length === 1) {
          next = next.map((ex) =>
            ex.superset_group === supersetGroup
              ? { ...ex, superset_group: null }
              : ex,
          );
        }
      }
      return { ...state, exercises: next };
    }
    case "setExerciseField": {
      const target = state.exercises.find((ex) => ex.id === action.exerciseId);
      const supersetGroup = target?.superset_group ?? null;
      const isShared =
        action.field === "target_sets" || action.field === "rest_seconds";
      const shouldPropagate = supersetGroup !== null && isShared;

      // A set count change keeps a per-set list the same length.
      const apply = (ex: WorkoutFormExercise): WorkoutFormExercise =>
        action.field === "target_sets" && ex.set_reps
          ? resizeSets(ex, action.value)
          : { ...ex, [action.field]: action.value };

      return {
        ...state,
        exercises: state.exercises.map((ex) => {
          if (shouldPropagate && ex.superset_group === supersetGroup) {
            return apply(ex);
          }
          if (ex.id === action.exerciseId) {
            return apply(ex);
          }
          return ex;
        }),
      };
    }
    case "setSetReps":
      return mapExercise(state, action.exerciseId, (ex) => {
        const reps = repsList(ex);
        if (action.setIndex < 0 || action.setIndex >= reps.length) return ex;
        reps[action.setIndex] = clampReps(action.reps);
        return { ...ex, ...withSetReps(reps) };
      });
    case "sameRepsForAll":
      return mapExercise(state, action.exerciseId, (ex) => {
        const reps = repsList(ex);
        return { ...ex, ...withSetReps(reps.map(() => reps[0]!)) };
      });
    // The set count is shared across a superset (like `target_sets` above),
    // so adding or removing a set applies to every member of the group.
    case "addSet":
      return mapSetGroup(state, action.exerciseId, (ex) =>
        ex.target_sets >= MAX_SETS
          ? ex
          : resizeSets(ex, Math.max(1, ex.target_sets + 1)),
      );
    case "removeSet":
      return mapSetGroup(state, action.exerciseId, (ex) => {
        if (ex.target_sets <= 1) return ex;
        if (!ex.set_reps) return { ...ex, target_sets: ex.target_sets - 1 };
        const reps = [...ex.set_reps];
        reps.splice(Math.min(action.setIndex, reps.length - 1), 1);
        return { ...ex, ...withSetReps(reps) };
      });
    case "moveExercise":
    case "reorderExercise": {
      const ordered = [...state.exercises].sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      const sourceIndex = ordered.findIndex(
        (ex) => ex.id === action.exerciseId,
      );
      if (sourceIndex < 0) return state;
      const source = ordered[sourceIndex];
      const blocks: WorkoutFormExercise[][] = [];
      const used = new Set<number>();
      for (const exercise of ordered) {
        if (exercise.superset_group == null) blocks.push([exercise]);
        else if (!used.has(exercise.superset_group)) {
          used.add(exercise.superset_group);
          blocks.push(
            ordered.filter(
              (candidate) =>
                candidate.superset_group === exercise.superset_group,
            ),
          );
        }
      }
      const sourceBlock = blocks.findIndex((block) => block.includes(source));
      const targetBlock =
        action.type === "moveExercise"
          ? sourceBlock + action.direction
          : action.toPosition;
      if (targetBlock < 0 || targetBlock >= blocks.length) return state;
      const targetIndex = ordered.indexOf(blocks[targetBlock][0]);
      const proxies = ordered.map((exercise) => ({
        exercise,
        sortOrder: exercise.sort_order,
        supersetGroup: exercise.superset_group,
      }));
      const reordered = reorderExercises(proxies, sourceIndex, targetIndex);
      return {
        ...state,
        exercises: reordered.map((proxy, index) => ({
          ...proxy.exercise,
          sort_order: index,
        })),
      };
    }
    case "reset":
      return action.state;
  }
}

/** The derived old-column values alongside a per-set list. */
function withSetReps(
  reps: number[],
): Pick<
  WorkoutFormExercise,
  "set_reps" | "target_sets" | "target_reps_min" | "target_reps_max"
> {
  const derived = deriveFromSetReps(reps);
  return {
    set_reps: reps,
    target_sets: derived.targetSets,
    target_reps_min: derived.targetRepsMin,
    target_reps_max: derived.targetRepsMax,
  };
}

/**
 * The per-set list to edit. An exercise with only the old range becomes one
 * set per `target_sets`, each at the top of the range (the value the set
 * editor steps from).
 */
function repsList(ex: WorkoutFormExercise): number[] {
  if (ex.set_reps) return [...ex.set_reps];
  // Not capped at 20: an old plan above the limit is refused by Save with
  // a message, never silently cut.
  const count = Math.max(1, ex.target_sets);
  return Array.from({ length: count }, () =>
    clampReps(ex.target_reps_max || DEFAULT_SET_REPS),
  );
}

/** Grow (repeating the last set's reps) or shrink a per-set list. */
function resizeSets(
  ex: WorkoutFormExercise,
  count: number,
): WorkoutFormExercise {
  if (!ex.set_reps || count < 1) return { ...ex, target_sets: count };
  const reps = ex.set_reps.slice(0, count);
  while (reps.length < count) {
    reps.push(reps[reps.length - 1] ?? DEFAULT_SET_REPS);
  }
  return { ...ex, ...withSetReps(reps) };
}

function mapExercise(
  state: WorkoutFormState,
  exerciseId: string,
  fn: (ex: WorkoutFormExercise) => WorkoutFormExercise,
): WorkoutFormState {
  return {
    ...state,
    exercises: state.exercises.map((ex) =>
      ex.id === exerciseId ? fn(ex) : ex,
    ),
  };
}

/** Apply to the exercise, or to its whole superset when it's in one. */
function mapSetGroup(
  state: WorkoutFormState,
  exerciseId: string,
  fn: (ex: WorkoutFormExercise) => WorkoutFormExercise,
): WorkoutFormState {
  const target = state.exercises.find((ex) => ex.id === exerciseId);
  if (!target) return state;
  const group = target.superset_group;
  return {
    ...state,
    exercises: state.exercises.map((ex) =>
      ex.id === exerciseId || (group !== null && ex.superset_group === group)
        ? fn(ex)
        : ex,
    ),
  };
}

export type WorkoutFormHandle = {
  state: WorkoutFormState;
  isDirty: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setVisibility: (value: WorkoutFormState["visibility"]) => void;
  setShowInOwnerLibrary: (value: boolean) => void;

  addExercises: (exercises: any[]) => void;

  addSuperset: (exercises: any[]) => void;
  removeExercise: (exerciseId: string) => void;
  setExerciseField: (exerciseId: string, field: string, value: number) => void;
  /** Set editor (PER-139): one set's reps, kept within 1–100. */
  setSetReps: (exerciseId: string, setIndex: number, reps: number) => void;
  /** Add a set, repeating the last set's reps (up to 20). */
  addSet: (exerciseId: string) => void;
  /** Remove a set (never the last one). */
  removeSet: (exerciseId: string, setIndex: number) => void;
  /** Every set takes set 1's reps. */
  sameRepsForAll: (exerciseId: string) => void;
  moveExercise: (exerciseId: string, direction: -1 | 1) => void;
  reorderExercise: (exerciseId: string, toPosition: number) => void;
  reset: (state: WorkoutFormState) => void;
};

export function useWorkoutForm(
  initialState: WorkoutFormState,
  generateId: () => string,
): WorkoutFormHandle {
  const [state, dispatch] = useReducer(reducer, initialState);
  // The "pristine" reference state is captured once and updated only on
  // explicit `reset` (e.g. when the editor's async load finishes). Compare
  // to current state for `isDirty`.
  const pristineRef = useRef<WorkoutFormState>(initialState);

  const isDirty = useMemo(() => {
    return !shallowEqualForm(state, pristineRef.current);
  }, [state]);

  const setName = useCallback(
    (value: string) => dispatch({ type: "setName", value }),
    [],
  );
  const setDescription = useCallback(
    (value: string) => dispatch({ type: "setDescription", value }),
    [],
  );
  const setVisibility = useCallback(
    (value: WorkoutFormState["visibility"]) =>
      dispatch({ type: "setVisibility", value }),
    [],
  );
  const setShowInOwnerLibrary = useCallback(
    (value: boolean) => dispatch({ type: "setShowInOwnerLibrary", value }),
    [],
  );
  const addExercises = useCallback(
    (exercises: any[]) =>
      dispatch({
        type: "addExercises",
        exercises,
        asSuperset: false,
        generateId,
      }),
    [generateId],
  );
  const addSuperset = useCallback(
    (exercises: any[]) =>
      dispatch({
        type: "addExercises",
        exercises,
        asSuperset: true,
        generateId,
      }),
    [generateId],
  );
  const removeExercise = useCallback(
    (exerciseId: string) => dispatch({ type: "removeExercise", exerciseId }),
    [],
  );
  const setExerciseField = useCallback(
    (exerciseId: string, field: string, value: number) =>
      dispatch({ type: "setExerciseField", exerciseId, field, value }),
    [],
  );
  const setSetReps = useCallback(
    (exerciseId: string, setIndex: number, reps: number) =>
      dispatch({ type: "setSetReps", exerciseId, setIndex, reps }),
    [],
  );
  const addSet = useCallback(
    (exerciseId: string) => dispatch({ type: "addSet", exerciseId }),
    [],
  );
  const removeSet = useCallback(
    (exerciseId: string, setIndex: number) =>
      dispatch({ type: "removeSet", exerciseId, setIndex }),
    [],
  );
  const sameRepsForAll = useCallback(
    (exerciseId: string) => dispatch({ type: "sameRepsForAll", exerciseId }),
    [],
  );
  const moveExercise = useCallback(
    (exerciseId: string, direction: -1 | 1) =>
      dispatch({ type: "moveExercise", exerciseId, direction }),
    [],
  );
  const reorderExercise = useCallback(
    (exerciseId: string, toPosition: number) =>
      dispatch({ type: "reorderExercise", exerciseId, toPosition }),
    [],
  );
  const reset = useCallback((next: WorkoutFormState) => {
    pristineRef.current = next;
    dispatch({ type: "reset", state: next });
  }, []);

  return {
    state,
    isDirty,
    setName,
    setDescription,
    setVisibility,
    setShowInOwnerLibrary,
    addExercises,
    addSuperset,
    removeExercise,
    setExerciseField,
    setSetReps,
    addSet,
    removeSet,
    sameRepsForAll,
    moveExercise,
    reorderExercise,
    reset,
  };
}

/** Same per-set reps (both null, or equal lists). */
export function sameSetReps(
  a: readonly number[] | null,
  b: readonly number[] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((reps, i) => reps === b[i]);
}

function shallowEqualForm(a: WorkoutFormState, b: WorkoutFormState): boolean {
  if (a === b) return true;
  if (a.name !== b.name) return false;
  if (a.description !== b.description) return false;
  if (a.visibility !== b.visibility) return false;
  if (a.showInOwnerLibrary !== b.showInOwnerLibrary) return false;
  if (a.exercises.length !== b.exercises.length) return false;
  for (let i = 0; i < a.exercises.length; i++) {
    const ax = a.exercises[i];
    const bx = b.exercises[i];
    if (
      ax.id !== bx.id ||
      ax.exercise_id !== bx.exercise_id ||
      ax.sort_order !== bx.sort_order ||
      ax.target_sets !== bx.target_sets ||
      ax.target_reps_min !== bx.target_reps_min ||
      ax.target_reps_max !== bx.target_reps_max ||
      ax.rest_seconds !== bx.rest_seconds ||
      ax.superset_group !== bx.superset_group ||
      !sameSetReps(ax.set_reps, bx.set_reps)
    ) {
      return false;
    }
  }
  return true;
}
