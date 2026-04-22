import { renderHook, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import {
  ExerciseFiltersPendingProvider,
  useExerciseFiltersPending,
} from "../useExerciseFiltersPending";
import { ExerciseFiltersProvider } from "../useExerciseFilters";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ExerciseFiltersProvider>
      <ExerciseFiltersPendingProvider>
        {children}
      </ExerciseFiltersPendingProvider>
    </ExerciseFiltersProvider>
  );
}

describe("useExerciseFiltersPending", () => {
  it("throws when used outside the provider", () => {
    // Silence React error noise for the expected throw.
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useExerciseFiltersPending());
    }).toThrow(/ExerciseFiltersPendingProvider/);
    jest.restoreAllMocks();
  });

  it("starts with empty selections when applied filters are empty", () => {
    const { result } = renderHook(() => useExerciseFiltersPending(), {
      wrapper,
    });
    expect(result.current.muscleGroups).toEqual([]);
    expect(result.current.equipment).toEqual([]);
    expect(result.current.difficulties).toEqual([]);
    expect(result.current.createdBy).toBeNull();
    expect(result.current.selectionCounts).toEqual({
      muscleGroups: 0,
      equipment: 0,
      difficulties: 0,
      createdBy: 0,
    });
  });

  it("toggles muscle groups idempotently", () => {
    const { result } = renderHook(() => useExerciseFiltersPending(), {
      wrapper,
    });
    act(() => result.current.toggleMuscleGroup("chest"));
    expect(result.current.muscleGroups).toEqual(["chest"]);
    act(() => result.current.toggleMuscleGroup("back"));
    expect(result.current.muscleGroups).toEqual(["chest", "back"]);
    // Toggle off
    act(() => result.current.toggleMuscleGroup("chest"));
    expect(result.current.muscleGroups).toEqual(["back"]);
  });

  it("toggles equipment and difficulty the same way", () => {
    const { result } = renderHook(() => useExerciseFiltersPending(), {
      wrapper,
    });
    act(() => result.current.toggleEquipment("barbell"));
    act(() => result.current.toggleEquipment("dumbbell"));
    act(() => result.current.toggleDifficulty("intermediate"));
    expect(result.current.equipment).toEqual(["barbell", "dumbbell"]);
    expect(result.current.difficulties).toEqual(["intermediate"]);
    expect(result.current.selectionCounts.equipment).toBe(2);
    expect(result.current.selectionCounts.difficulties).toBe(1);
  });

  it("createdBy is a radio — tapping selected value clears it", () => {
    const { result } = renderHook(() => useExerciseFiltersPending(), {
      wrapper,
    });
    act(() => result.current.selectCreatedBy("mine"));
    expect(result.current.createdBy).toBe("mine");
    // Tap the other value — swaps
    act(() => result.current.selectCreatedBy("system"));
    expect(result.current.createdBy).toBe("system");
    // Tap selected — clears
    act(() => result.current.selectCreatedBy("system"));
    expect(result.current.createdBy).toBeNull();
  });

  it("clearAll resets every axis", () => {
    const { result } = renderHook(() => useExerciseFiltersPending(), {
      wrapper,
    });
    act(() => {
      result.current.toggleMuscleGroup("chest");
      result.current.toggleEquipment("barbell");
      result.current.toggleDifficulty("beginner");
      result.current.selectCreatedBy("mine");
    });
    expect(result.current.selectionCounts).toEqual({
      muscleGroups: 1,
      equipment: 1,
      difficulties: 1,
      createdBy: 1,
    });
    act(() => result.current.clearAll());
    expect(result.current.selectionCounts).toEqual({
      muscleGroups: 0,
      equipment: 0,
      difficulties: 0,
      createdBy: 0,
    });
    expect(result.current.createdBy).toBeNull();
  });
});
