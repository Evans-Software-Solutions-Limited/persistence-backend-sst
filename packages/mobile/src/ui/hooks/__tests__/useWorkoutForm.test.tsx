import { act, renderHook } from "@testing-library/react-native";
import { EMPTY_FORM_STATE, useWorkoutForm } from "@/ui/hooks/useWorkoutForm";

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

  it("tracks description + estimated duration + visibility", () => {
    const { result } = renderHook(() =>
      useWorkoutForm(EMPTY_FORM_STATE, generateId()),
    );
    act(() => result.current.setDescription("warm up first"));
    act(() => result.current.setEstimatedDuration(45));
    act(() => result.current.setVisibility("friends"));
    expect(result.current.state.description).toBe("warm up first");
    expect(result.current.state.estimatedDurationMinutes).toBe(45);
    expect(result.current.state.visibility).toBe("friends");
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
    act(() => result.current.setExerciseField(lead.id, "target_reps_min", 10));
    expect(result.current.state.exercises[0].target_reps_min).toBe(10);
    expect(result.current.state.exercises[1].target_reps_min).toBe(8);
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
        estimatedDurationMinutes: 30,
        visibility: "private",
        showInOwnerLibrary: true,
        exercises: [],
      }),
    );
    expect(result.current.isDirty).toBe(false);
  });
});
