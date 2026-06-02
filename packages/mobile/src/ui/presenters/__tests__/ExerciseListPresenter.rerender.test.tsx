import { View } from "react-native";
import type { Exercise } from "@/domain/models/exercise";
import { renderWithTheme } from "../../../../__tests__/test-utils";

// Regression test: FlatList renderItem must be referentially stable across
// unrelated presenter re-renders, and ExerciseCard must be memoised, so
// that cells don't re-render when only `isRefreshing` / `searchInput` etc.
// change. Uses a jest.mock on the components barrel to count how many
// times ExerciseCard is actually invoked.

const mockExerciseCardRenderSpy = jest.fn();

// The presenter imports the LIBRARY card from `@/ui/components/exercises/
// ExerciseCard` (distinct from the root card). Mock that module so we can
// count actual cell renders.
jest.mock("@/ui/components/exercises/ExerciseCard", () => {
  const React = jest.requireActual("react") as typeof import("react");
  const memoisedCard = React.memo(function SpiedExerciseCard(props: {
    exercise: { id: string };
    onPress: (id: string) => void;
    testID?: string;
  }) {
    mockExerciseCardRenderSpy(props.exercise.id);
    const { Text } = jest.requireActual(
      "react-native",
    ) as typeof import("react-native");
    return <Text testID={props.testID}>{props.exercise.id}</Text>;
  });
  return { ExerciseCard: memoisedCard };
});

// eslint-disable-next-line import/first
import { ExerciseListPresenter } from "../ExerciseListPresenter";

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1",
    name: "Barbell Back Squat",
    description: null,
    instructions: null,
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["quadriceps"],
    secondaryMuscleGroups: [],
    equipment: ["barbell"],
    videoUrl: null,
    thumbnailUrl: null,
    isCustom: false,
    createdBy: null,
    ...overrides,
  };
}

// Stable exercise identities across rerenders — the real container keeps
// the same object references when the cache is unchanged, so the test
// mirrors that contract. If we create fresh objects per rerender the
// memoised card legitimately re-renders (new `exercise` prop) and the
// test would be checking the wrong thing.
const STABLE_EXERCISES: Exercise[] = [
  makeExercise({ id: "ex-1" }),
  makeExercise({ id: "ex-2" }),
  makeExercise({ id: "ex-3" }),
];

function makeProps(
  callbacks: {
    onSearchChange: () => void;
    onToggleQuickFilter: () => void;
    onOpenFilterModal: () => void;
    onClearFilters: () => void;
    onRefresh: () => void;
    onSelectExercise: () => void;
    onCreateExercise: () => void;
  },
  overrides: Partial<Parameters<typeof ExerciseListPresenter>[0]> = {},
): Parameters<typeof ExerciseListPresenter>[0] {
  return {
    exercises: STABLE_EXERCISES,
    searchInput: "",
    selectedQuickFilters: ["all"],
    hasAdvancedFilters: false,
    hasAnyFilter: false,
    lastSyncedAt: null,
    isStale: false,
    isRefreshing: false,
    showSkeleton: false,
    loadError: null,
    ...callbacks,
    ...overrides,
  };
}

function makeStableCallbacks() {
  return {
    onSearchChange: jest.fn(),
    onToggleQuickFilter: jest.fn(),
    onOpenFilterModal: jest.fn(),
    onClearFilters: jest.fn(),
    onRefresh: jest.fn(),
    onSelectExercise: jest.fn(),
    onCreateExercise: jest.fn(),
  };
}

describe("ExerciseListPresenter — FlatList re-render efficiency", () => {
  beforeEach(() => {
    mockExerciseCardRenderSpy.mockClear();
  });

  it("does not re-render exercise cards when only isRefreshing changes", () => {
    const callbacks = makeStableCallbacks();

    const { rerender } = renderWithTheme(
      <View>
        <ExerciseListPresenter
          {...makeProps(callbacks, { isRefreshing: false })}
        />
      </View>,
    );

    expect(mockExerciseCardRenderSpy.mock.calls.length).toBe(3); // one per exercise
    mockExerciseCardRenderSpy.mockClear();

    // Trigger a presenter re-render by flipping an unrelated prop. Cells
    // should skip rendering — with stable renderItem + memoised ExerciseCard
    // + unchanged exercise/onPress/testID props, React bails out.
    rerender(
      <View>
        <ExerciseListPresenter
          {...makeProps(callbacks, { isRefreshing: true })}
        />
      </View>,
    );

    // Under the bug (inline renderItem closure + no memo), each cell would
    // have re-rendered — 3 calls. With both fixes in place, zero.
    expect(mockExerciseCardRenderSpy).not.toHaveBeenCalled();
  });

  it("does not re-render exercise cards when only searchInput changes", () => {
    const callbacks = makeStableCallbacks();

    const { rerender } = renderWithTheme(
      <View>
        <ExerciseListPresenter {...makeProps(callbacks, { searchInput: "" })} />
      </View>,
    );
    mockExerciseCardRenderSpy.mockClear();

    // Simulate six keystrokes' worth of parent re-render. None of them
    // should hit the cells.
    for (const text of ["p", "pr", "pre", "pres", "press", "press "]) {
      rerender(
        <View>
          <ExerciseListPresenter
            {...makeProps(callbacks, { searchInput: text })}
          />
        </View>,
      );
    }
    expect(mockExerciseCardRenderSpy).not.toHaveBeenCalled();
  });

  it("does re-render cells when the exercises array changes", () => {
    const callbacks = makeStableCallbacks();
    const initialExercises = [makeExercise({ id: "ex-1" })];

    const { rerender } = renderWithTheme(
      <View>
        <ExerciseListPresenter
          {...makeProps(callbacks, { exercises: initialExercises })}
        />
      </View>,
    );
    mockExerciseCardRenderSpy.mockClear();

    rerender(
      <View>
        <ExerciseListPresenter
          {...makeProps(callbacks, {
            exercises: [
              initialExercises[0], // keep same reference
              makeExercise({ id: "ex-2" }), // new card
            ],
          })}
        />
      </View>,
    );

    // The new card (ex-2) must render at least once. ex-1 keeps the same
    // exercise object reference so memo bails.
    expect(
      mockExerciseCardRenderSpy.mock.calls.some(([id]) => id === "ex-2"),
    ).toBe(true);
  });
});
