import { useCallback, useMemo, useReducer, useRef } from "react";

/**
 * Form-state hook for the workout creator + editor. Holds the in-flight
 * shape in legacy snake_case so the verbatim-ported `ExerciseConfigCard`
 * consumes it without a per-row view-mapping. The submit boundary
 * converts to V2 camelCase via `toCreateWorkoutInput` /
 * `toUpdateWorkoutInput` (called by the container).
 *
 * Reducer-based (no react-hook-form dependency) per FRONTEND_BRIEF
 * § Architecture > "form reducer over CreateWorkoutInput".
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
};

export type WorkoutFormState = {
  name: string;
  description: string;
  estimatedDurationMinutes: number;
  visibility: "private" | "friends" | "public";
  exercises: WorkoutFormExercise[];
};

export const EMPTY_FORM_STATE: WorkoutFormState = {
  name: "",
  description: "",
  estimatedDurationMinutes: 30,
  visibility: "private",
  exercises: [],
};

type Action =
  | { type: "setName"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setEstimatedDuration"; value: number }
  | { type: "setVisibility"; value: WorkoutFormState["visibility"] }
  | {
      type: "addExercises";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  | { type: "reset"; state: WorkoutFormState };

function reducer(state: WorkoutFormState, action: Action): WorkoutFormState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.value };
    case "setDescription":
      return { ...state, description: action.value };
    case "setEstimatedDuration":
      return { ...state, estimatedDurationMinutes: action.value };
    case "setVisibility":
      return { ...state, visibility: action.value };
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
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 12,
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

      return {
        ...state,
        exercises: state.exercises.map((ex) => {
          if (shouldPropagate && ex.superset_group === supersetGroup) {
            return { ...ex, [action.field]: action.value };
          }
          if (ex.id === action.exerciseId) {
            return { ...ex, [action.field]: action.value };
          }
          return ex;
        }),
      };
    }
    case "reset":
      return action.state;
  }
}

export type WorkoutFormHandle = {
  state: WorkoutFormState;
  isDirty: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setEstimatedDuration: (value: number) => void;
  setVisibility: (value: WorkoutFormState["visibility"]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addExercises: (exercises: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addSuperset: (exercises: any[]) => void;
  removeExercise: (exerciseId: string) => void;
  setExerciseField: (exerciseId: string, field: string, value: number) => void;
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
  const setEstimatedDuration = useCallback(
    (value: number) => dispatch({ type: "setEstimatedDuration", value }),
    [],
  );
  const setVisibility = useCallback(
    (value: WorkoutFormState["visibility"]) =>
      dispatch({ type: "setVisibility", value }),
    [],
  );
  const addExercises = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const reset = useCallback((next: WorkoutFormState) => {
    pristineRef.current = next;
    dispatch({ type: "reset", state: next });
  }, []);

  return {
    state,
    isDirty,
    setName,
    setDescription,
    setEstimatedDuration,
    setVisibility,
    addExercises,
    addSuperset,
    removeExercise,
    setExerciseField,
    reset,
  };
}

function shallowEqualForm(a: WorkoutFormState, b: WorkoutFormState): boolean {
  if (a === b) return true;
  if (a.name !== b.name) return false;
  if (a.description !== b.description) return false;
  if (a.estimatedDurationMinutes !== b.estimatedDurationMinutes) return false;
  if (a.visibility !== b.visibility) return false;
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
      ax.superset_group !== bx.superset_group
    ) {
      return false;
    }
  }
  return true;
}
