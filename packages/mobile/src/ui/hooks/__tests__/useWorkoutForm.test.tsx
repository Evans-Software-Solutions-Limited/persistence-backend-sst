import { act, renderHook } from "@testing-library/react-native";
import {
  EMPTY_FORM_STATE,
  sameSetReps,
  useWorkoutForm,
  type WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";

function generateId() {
  let i = 0;
  return () => `id-${++i}`;
}

describe("useWorkoutForm", () => {
  it("starts pristine; isDirty flips on any field change", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setName("Push Day"));
    expect(result.current.state.name).toBe("Push Day");
    expect(result.current.isDirty).toBe(true);
  });

  it("tracks description + visibility", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() => result.current.setDescription("warm up first"));
    act(() => result.current.setVisibility("friends"));
    expect(result.current.state.description).toBe("warm up first");
    expect(result.current.state.visibility).toBe("friends");
  });

  it("holds no duration field — the server derives it from the plan", () => {
    // Regression guard: the form used to seed `estimatedDurationMinutes: 30`
    // with no UI to change it, and the container sent that 30 on every create,
    // pinning every workout to "30 min".
    expect(EMPTY_FORM_STATE).not.toHaveProperty("estimatedDurationMinutes");
  });

  it("addExercises stamps incremental sort_order + null superset_group", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addExercises([
        { id: "ex-a", name: "Bench" },
        { id: "ex-b", name: "Row" },
      ]),
    );
    const exs = result.current.state.exercises;
    expect(exs).toHaveLength(2);
    expect(exs[0].exercise_id).toBe("ex-a");
    expect(exs[0].sort_order).toBe(1);
    expect(exs[1].sort_order).toBe(2);
    expect(exs.every((ex) => ex.superset_group === null)).toBe(true);
  });

  it("addSuperset stamps a fresh superset_group across selections", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addSuperset([
        { id: "ex-a", name: "Bench" },
        { id: "ex-b", name: "Fly" },
      ]),
    );
    const exs = result.current.state.exercises;
    expect(exs[0].superset_group).toBe(1);
    expect(exs[1].superset_group).toBe(1);
  });

  it("subsequent addSuperset gets a new monotonic group integer", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addSuperset([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]),
    );
    act(() =>
      result.current.addSuperset([
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ]),
    );
    const exs = result.current.state.exercises;
    expect(exs[0].superset_group).toBe(1);
    expect(exs[2].superset_group).toBe(2);
  });

  it("removeExercise drops the row; ungroups orphan superset peer", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addSuperset([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]),
    );
    const [first, second] = result.current.state.exercises;

    act(() => result.current.removeExercise(first.id));
    expect(result.current.state.exercises).toHaveLength(1);
    expect(result.current.state.exercises[0].id).toBe(second.id);
    // Single peer left → superset_group cleared.
    expect(result.current.state.exercises[0].superset_group).toBeNull();
  });

  it("setExerciseField propagates target_sets across superset peers", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addSuperset([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]),
    );
    const lead = result.current.state.exercises[0];
    act(() => result.current.setExerciseField(lead.id, "target_sets", 5));
    expect(result.current.state.exercises[0].target_sets).toBe(5);
    expect(result.current.state.exercises[1].target_sets).toBe(5);
  });

  it("setExerciseField does NOT propagate non-shared fields", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() =>
      result.current.addSuperset([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]),
    );
    const lead = result.current.state.exercises[0];
    act(() => result.current.setExerciseField(lead.id, "target_reps_min", 6));
    expect(result.current.state.exercises[0].target_reps_min).toBe(6);
    expect(result.current.state.exercises[1].target_reps_min).toBe(10);
  });

  it("moves a two-member superset as one block and marks the form dirty", () => {
    const ids = generateId();
    const { result } = renderHook(() => useWorkoutForm(EMPTY_FORM_STATE, ids));
    act(() => result.current.addExercises([{ id: "a", name: "A" }]));
    act(() =>
      result.current.addSuperset([
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ]),
    );
    const supersetLead = result.current.state.exercises[1];
    act(() => result.current.moveExercise(supersetLead.id, -1));
    expect(
      result.current.state.exercises.map((exercise) => exercise.exercise_name),
    ).toEqual(["B", "C", "A"]);
    expect(
      result.current.state.exercises
        .slice(0, 2)
        .map((exercise) => exercise.superset_group),
    ).toEqual([1, 1]);
    expect(result.current.isDirty).toBe(true);
  });

  it("reorders across multiple positions while keeping a superset intact", () => {
    const ids = generateId();
    const { result } = renderHook(() => useWorkoutForm(EMPTY_FORM_STATE, ids));
    act(() =>
      result.current.addSuperset([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]),
    );
    act(() =>
      result.current.addExercises([
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ]),
    );
    const leadId = result.current.state.exercises[0].id;

    act(() => result.current.reorderExercise(leadId, 2));

    expect(
      result.current.state.exercises.map((exercise) => exercise.exercise_name),
    ).toEqual(["C", "D", "A", "B"]);
    expect(
      result.current.state.exercises.map((exercise) => exercise.sort_order),
    ).toEqual([0, 1, 2, 3]);
  });

  it("reset re-anchors pristine baseline; isDirty becomes false", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() => result.current.setName("hello"));
    expect(result.current.isDirty).toBe(true);

    act(() =>
      result.current.reset({
        name: "hello",
        description: "",
        visibility: "private",
        showInOwnerLibrary: true,
        exercises: [],
      }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  describe("set editor (PER-139)", () => {
    const legacy: WorkoutFormState = {
      name: "Old",
      description: "",
      visibility: "private",
      showInOwnerLibrary: true,
      exercises: [
        {
          id: "x",
          exercise_id: "ex-x",
          exercise_name: "Press",
          sort_order: 0,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 12,
          rest_seconds: 60,
          superset_group: null,
          set_reps: null,
        },
      ],
    };

    it("a new exercise starts as 3 sets of 10, with the derived range", () => {
      const { result } = renderHook(() =>
        useWorkoutForm(EMPTY_FORM_STATE, generateId()),
      );
      act(() => result.current.addExercises([{ id: "a", name: "A" }]));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: [10, 10, 10],
        target_sets: 3,
        target_reps_min: 10,
        target_reps_max: 10,
      });
    });

    it("setSetReps changes one set, clamps to 1–100 and re-derives the range", () => {
      const { result } = renderHook(() =>
        useWorkoutForm(EMPTY_FORM_STATE, generateId()),
      );
      act(() => result.current.addExercises([{ id: "a", name: "A" }]));
      const id = result.current.state.exercises[0].id;
      act(() => result.current.setSetReps(id, 1, 8));
      act(() => result.current.setSetReps(id, 2, 8));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: [10, 8, 8],
        target_reps_min: 8,
        target_reps_max: 10,
      });
      act(() => result.current.setSetReps(id, 0, 500));
      expect(result.current.state.exercises[0].set_reps?.[0]).toBe(100);
      act(() => result.current.setSetReps(id, 0, 0));
      expect(result.current.state.exercises[0].set_reps?.[0]).toBe(1);
      // Out of range index: nothing changes.
      const before = result.current.state;
      act(() => result.current.setSetReps(id, 9, 5));
      expect(result.current.state.exercises).toEqual(before.exercises);
      expect(result.current.isDirty).toBe(true);
    });

    it("an old range stays as saved until a set's reps change", () => {
      const { result } = renderHook(() => useWorkoutForm(legacy, generateId()));
      act(() => result.current.addSet("x"));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: null,
        target_sets: 4,
        target_reps_min: 8,
        target_reps_max: 12,
      });
      act(() => result.current.removeSet("x", 0));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: null,
        target_sets: 3,
      });
      // Changing a set's reps turns it into per-set reps from the top (12).
      act(() => result.current.setSetReps("x", 1, 11));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: [12, 11, 12],
        target_sets: 3,
        target_reps_min: 11,
        target_reps_max: 12,
      });
    });

    it("Same reps for all uses set 1 (an old range from its top)", () => {
      const { result } = renderHook(() => useWorkoutForm(legacy, generateId()));
      act(() => result.current.sameRepsForAll("x"));
      expect(result.current.state.exercises[0].set_reps).toEqual([12, 12, 12]);
      act(() => result.current.setSetReps("x", 0, 6));
      act(() => result.current.sameRepsForAll("x"));
      expect(result.current.state.exercises[0]).toMatchObject({
        set_reps: [6, 6, 6],
        target_reps_min: 6,
        target_reps_max: 6,
      });
    });

    it("addSet repeats the last set's reps and stops at 20", () => {
      const { result } = renderHook(() =>
        useWorkoutForm(EMPTY_FORM_STATE, generateId()),
      );
      act(() => result.current.addExercises([{ id: "a", name: "A" }]));
      const id = result.current.state.exercises[0].id;
      act(() => result.current.setSetReps(id, 2, 6));
      act(() => result.current.addSet(id));
      expect(result.current.state.exercises[0].set_reps).toEqual([
        10, 10, 6, 6,
      ]);
      for (let i = 0; i < 30; i += 1) act(() => result.current.addSet(id));
      expect(result.current.state.exercises[0].target_sets).toBe(20);
      expect(result.current.state.exercises[0].set_reps).toHaveLength(20);
    });

    it("removeSet removes that set, never the last one", () => {
      const { result } = renderHook(() =>
        useWorkoutForm(EMPTY_FORM_STATE, generateId()),
      );
      act(() => result.current.addExercises([{ id: "a", name: "A" }]));
      const id = result.current.state.exercises[0].id;
      act(() => result.current.setSetReps(id, 0, 12));
      act(() => result.current.removeSet(id, 0));
      expect(result.current.state.exercises[0].set_reps).toEqual([10, 10]);
      act(() => result.current.removeSet(id, 5)); // past the end: the last
      act(() => result.current.removeSet(id, 0));
      expect(result.current.state.exercises[0].set_reps).toEqual([10]);
      expect(result.current.state.exercises[0].target_sets).toBe(1);
      act(() => result.current.removeSet("missing", 0));
      expect(result.current.state.exercises[0].set_reps).toEqual([10]);
    });

    it("adding or removing a set applies to the whole superset; reps stay per member", () => {
      const { result } = renderHook(() =>
        useWorkoutForm(EMPTY_FORM_STATE, generateId()),
      );
      act(() =>
        result.current.addSuperset([
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ]),
      );
      const [lead, peer] = result.current.state.exercises;
      act(() => result.current.setSetReps(peer!.id, 0, 15));
      act(() => result.current.addSet(lead!.id));
      expect(result.current.state.exercises[0].set_reps).toHaveLength(4);
      expect(result.current.state.exercises[1].set_reps).toEqual([
        15, 10, 10, 10,
      ]);
      act(() => result.current.removeSet(lead!.id, 0));
      expect(result.current.state.exercises[1].set_reps).toEqual([10, 10, 10]);
      // target_sets through setExerciseField keeps lists the same length.
      act(() => result.current.setExerciseField(lead!.id, "target_sets", 2));
      expect(result.current.state.exercises[0].set_reps).toEqual([10, 10]);
      expect(result.current.state.exercises[1].set_reps).toEqual([10, 10]);
    });

    it("isDirty sees per-set reps changes; sameSetReps compares lists", () => {
      const { result } = renderHook(() => useWorkoutForm(legacy, generateId()));
      expect(result.current.isDirty).toBe(false);
      act(() => result.current.setSetReps("x", 0, 12));
      expect(result.current.isDirty).toBe(true);
      expect(sameSetReps(null, null)).toBe(true);
      expect(sameSetReps([1, 2], [1, 2])).toBe(true);
      expect(sameSetReps([1, 2], [1, 3])).toBe(false);
      expect(sameSetReps([1], null)).toBe(false);
      expect(sameSetReps([1], [1, 1])).toBe(false);
    });
  });
});
