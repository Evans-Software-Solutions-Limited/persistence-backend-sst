import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import type { ExerciseFilters } from "@/domain/models/exercise";
import {
  ExerciseFiltersProvider,
  nextQuickFilters,
  useExerciseFilters,
  type ExerciseFiltersContextValue,
} from "../useExerciseFilters";

/**
 * Most of the hook's interesting logic is in the pure `nextQuickFilters`
 * function and the derived `filters` memo. We test those directly and
 * exercise the full Provider path through a thin harness component.
 */

describe("nextQuickFilters (pure)", () => {
  it("replaces everything with ['all'] when 'all' is toggled", () => {
    expect(nextQuickFilters(["beginner", "mine"], "all")).toEqual(["all"]);
  });

  it("toggling a difficulty pill from 'all' replaces it with the pill", () => {
    expect(nextQuickFilters(["all"], "beginner")).toEqual(["beginner"]);
  });

  it("toggling a second difficulty pill appends (OR within axis)", () => {
    expect(nextQuickFilters(["beginner"], "advanced")).toEqual([
      "beginner",
      "advanced",
    ]);
  });

  it("deselecting the last pill falls back to 'all'", () => {
    expect(nextQuickFilters(["beginner"], "beginner")).toEqual(["all"]);
  });

  it("'mine' and 'system' are mutually exclusive on the createdBy axis", () => {
    expect(nextQuickFilters(["mine", "beginner"], "system")).toEqual([
      "beginner",
      "system",
    ]);
  });

  it("toggling the same createdBy pill deselects it", () => {
    expect(nextQuickFilters(["mine", "beginner"], "mine")).toEqual([
      "beginner",
    ]);
  });

  it("deselecting the only createdBy pill falls back to 'all'", () => {
    expect(nextQuickFilters(["mine"], "mine")).toEqual(["all"]);
  });
});

function Harness({
  capture,
}: {
  capture: (value: ExerciseFiltersContextValue) => void;
}) {
  const value = useExerciseFilters();
  capture(value);
  return <Text testID="harness">ready</Text>;
}

describe("ExerciseFiltersProvider / useExerciseFilters", () => {
  it("throws a descriptive error when used outside the provider", () => {
    const silenceError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      expect(() => render(<Harness capture={() => {}} />)).toThrow(
        /must be used within an ExerciseFiltersProvider/,
      );
    } finally {
      silenceError.mockRestore();
    }
  });

  it("initialises with 'all' quick filter and no advanced state", () => {
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );
    expect(captured).not.toBeNull();
    const value = captured!;
    expect(value.quickFilters).toEqual(["all"]);
    expect(value.muscleGroups).toEqual([]);
    expect(value.equipment).toEqual([]);
    expect(value.difficultiesAdvanced).toEqual([]);
    expect(value.search).toBe("");
    expect(value.hasAdvancedFilters).toBe(false);
    expect(value.hasAnyFilter).toBe(false);
    expect(value.filters).toEqual({});
    expect(value.filtersWithoutSearch).toEqual({});
  });

  it("filtersWithoutSearch reference is stable across setSearch calls", () => {
    // Regression test for the debounce bug: when only `search` changes, the
    // `filtersWithoutSearch` memo must keep its reference so downstream
    // memos (in ExerciseListContainer) don't recompute per keystroke.
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );

    const initial = captured!.filtersWithoutSearch;
    act(() => captured!.setSearch("a"));
    const afterOne = captured!.filtersWithoutSearch;
    act(() => captured!.setSearch("ab"));
    const afterTwo = captured!.filtersWithoutSearch;
    act(() => captured!.setSearch("abc"));
    const afterThree = captured!.filtersWithoutSearch;

    expect(afterOne).toBe(initial);
    expect(afterTwo).toBe(initial);
    expect(afterThree).toBe(initial);

    // Changing a non-search axis SHOULD produce a new reference though.
    act(() => captured!.toggleQuickFilter("beginner"));
    expect(captured!.filtersWithoutSearch).not.toBe(initial);
  });

  it("derives a typed ExerciseFilters object from quick + advanced + search", () => {
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );

    act(() => captured!.toggleQuickFilter("beginner"));
    act(() => captured!.toggleQuickFilter("mine"));
    act(() =>
      captured!.applyAdvanced({
        muscleGroups: ["chest"],
        equipment: ["barbell"],
        difficulties: ["advanced"],
      }),
    );
    act(() => captured!.setSearch("  press  "));

    const expected: ExerciseFilters = {
      search: "press",
      muscleGroups: ["chest"],
      equipment: ["barbell"],
      difficulties: expect.arrayContaining([
        "beginner",
        "advanced",
      ]) as unknown as ExerciseFilters["difficulties"],
      createdBy: "mine",
    };
    expect(captured!.filters).toEqual(expected);
    expect(captured!.hasAdvancedFilters).toBe(true);
    expect(captured!.hasAnyFilter).toBe(true);
  });

  it("clearAll resets the entire state", () => {
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );

    act(() => captured!.toggleQuickFilter("beginner"));
    act(() =>
      captured!.applyAdvanced({
        muscleGroups: ["chest"],
        equipment: ["barbell"],
        difficulties: [],
      }),
    );
    act(() => captured!.setSearch("bench"));

    expect(captured!.hasAnyFilter).toBe(true);

    act(() => captured!.clearAll());

    expect(captured!.quickFilters).toEqual(["all"]);
    expect(captured!.muscleGroups).toEqual([]);
    expect(captured!.equipment).toEqual([]);
    expect(captured!.difficultiesAdvanced).toEqual([]);
    expect(captured!.search).toBe("");
    expect(captured!.hasAnyFilter).toBe(false);
    expect(captured!.filters).toEqual({});
  });

  it("whitespace-only search does not populate filters.search", () => {
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );
    act(() => captured!.setSearch("   "));
    expect(captured!.filters.search).toBeUndefined();
    // hasAnyFilter should still be false because nothing else is set.
    expect(captured!.hasAnyFilter).toBe(false);
  });

  it("quick-filter difficulties merge (dedup) with advanced difficulties", () => {
    let captured: ExerciseFiltersContextValue | null = null;
    render(
      <ExerciseFiltersProvider>
        <Harness capture={(v) => (captured = v)} />
      </ExerciseFiltersProvider>,
    );
    act(() => captured!.toggleQuickFilter("beginner"));
    act(() =>
      captured!.applyAdvanced({
        muscleGroups: [],
        equipment: [],
        difficulties: ["beginner", "expert"],
      }),
    );
    // Merge should dedup "beginner" and keep both distinct values.
    expect(captured!.filters.difficulties?.sort()).toEqual(
      ["beginner", "expert"].sort(),
    );
  });
});
