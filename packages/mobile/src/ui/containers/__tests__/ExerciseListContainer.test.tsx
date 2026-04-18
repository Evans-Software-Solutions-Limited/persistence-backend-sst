import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Exercise } from "@/domain/models/exercise";
import type { Adapters } from "@/shared/types";
import { ExerciseListPresenter } from "@/ui/presenters/ExerciseListPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { ExerciseListContainer } from "../ExerciseListContainer";

jest.setTimeout(15_000);

// Mock the presenter so container tests assert behaviour via props.
jest.mock("@/ui/presenters/ExerciseListPresenter");
const MockPresenter = jest.mocked(ExerciseListPresenter);

// Mock expo-router.
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));
// eslint-disable-next-line import/first
import { useRouter } from "expo-router";
const mockUseRouter = jest.mocked(useRouter);

let lastProps: Parameters<typeof ExerciseListPresenter>[0] | null = null;

MockPresenter.mockImplementation((props) => {
  lastProps = props;
  return (
    <View testID="presenter-stub">
      <TextInput
        testID="stub-search"
        value={props.searchInput}
        onChangeText={props.onSearchChange}
      />
      <Pressable
        testID="stub-refresh"
        onPress={() => {
          void props.onRefresh();
        }}
      />
      <Pressable testID="stub-clear" onPress={props.onClearFilters} />
      <Pressable
        testID="stub-toggle-muscle"
        onPress={() => props.onToggleMuscleGroup("chest")}
      />
      <Pressable
        testID="stub-toggle-equipment"
        onPress={() => props.onToggleEquipment("barbell")}
      />
      <Pressable
        testID="stub-select-category"
        onPress={() => props.onSelectCategory("strength")}
      />
      <Pressable
        testID="stub-select-difficulty"
        onPress={() => props.onSelectDifficulty("intermediate")}
      />
      <Pressable
        testID="stub-select-exercise"
        onPress={() => props.onSelectExercise("ex-1")}
      />
      <Pressable
        testID="stub-create-exercise"
        onPress={props.onCreateExercise}
      />
      <Text testID="stub-count">{props.exercises.length}</Text>
      <Text testID="stub-refreshing">
        {props.isRefreshing ? "true" : "false"}
      </Text>
      <Text testID="stub-skeleton">
        {props.showSkeleton ? "true" : "false"}
      </Text>
      <Text testID="stub-load-error">{props.loadError ?? "none"}</Text>
    </View>
  );
});

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
    isCustom: false,
    createdBy: null,
    ...overrides,
  };
}

function createTestAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api,
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new StubPaymentsAdapter(),
  };
  return { adapters, api, storage };
}

function TestWrapper({
  children,
  adapters,
}: {
  children: ReactNode;
  adapters: Adapters;
}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

describe("ExerciseListContainer", () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    lastProps = null;
    mockPush.mockClear();
    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("refreshes from a stale empty cache on mount and surfaces exercises", async () => {
    const { adapters, api, storage } = createTestAdapters();
    api.exercises = [makeExercise(), makeExercise({ id: "ex-2", name: "Row" })];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });
    expect(storage.getLastSyncedAt("exercises")).not.toBeNull();
    expect(lastProps?.isStale).toBe(false);
    expect(lastProps?.isRefreshing).toBe(false);
  });

  it("surfaces loadError when refresh fails and there is no cached data", async () => {
    const { adapters, api } = createTestAdapters();
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "server",
      message: "boom",
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-load-error").props.children).toBe("boom");
    });
    expect(lastProps?.exercises.length).toBe(0);
  });

  it("keeps cached exercises visible when a later refresh fails", async () => {
    const { adapters, api, storage } = createTestAdapters();
    const seeded = makeExercise({ id: "seed", name: "Bench" });
    storage.cacheExercises([seeded]);
    storage.setLastSyncedAt("exercises", new Date().toISOString());
    api.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });

    // Initial render used non-stale cache; trigger manual refresh and see it fail
    // without blowing away the list.
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    await waitFor(() => {
      expect(lastProps?.isRefreshing).toBe(false);
    });
    expect(getByTestId("stub-count").props.children).toBe(1);
    expect(getByTestId("stub-load-error").props.children).toBe("none");
  });

  it("filters exercises after the search debounce settles", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [
      makeExercise({ id: "a", name: "Barbell Squat" }),
      makeExercise({ id: "b", name: "Lat Pulldown" }),
    ];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-search"), "pulldown");
    });
    // Full list still visible before the 300ms debounce elapses.
    expect(getByTestId("stub-count").props.children).toBe(2);

    await waitFor(
      () => {
        expect(getByTestId("stub-count").props.children).toBe(1);
      },
      { timeout: 2000, interval: 50 },
    );
  });

  it("applies muscle group, equipment, category and difficulty filters", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [
      makeExercise({
        id: "chest-barbell-strength-intermediate",
        name: "Bench Press",
        category: "strength",
        difficulty: "intermediate",
        primaryMuscleGroups: ["chest"],
        equipment: ["barbell"],
      }),
      makeExercise({
        id: "back-cable-strength-beginner",
        name: "Cable Row",
        category: "strength",
        difficulty: "beginner",
        primaryMuscleGroups: ["back"],
        equipment: ["cable"],
      }),
    ];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-muscle"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });
    expect(lastProps?.muscleGroups).toEqual(["chest"]);

    // Toggle off -> back to 2
    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-muscle"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-equipment"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });
    expect(lastProps?.equipment).toEqual(["barbell"]);

    await act(async () => {
      fireEvent.press(getByTestId("stub-select-difficulty"));
    });
    await waitFor(() => {
      expect(lastProps?.difficulty).toBe("intermediate");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-select-category"));
    });
    await waitFor(() => {
      expect(lastProps?.category).toBe("strength");
    });

    // Clear all and ensure every filter resets.
    await act(async () => {
      fireEvent.press(getByTestId("stub-clear"));
    });
    await waitFor(() => {
      expect(lastProps?.muscleGroups).toEqual([]);
      expect(lastProps?.equipment).toEqual([]);
      expect(lastProps?.category).toBeNull();
      expect(lastProps?.difficulty).toBeNull();
      expect(lastProps?.searchInput).toBe("");
    });
  });

  it("navigates to the detail route when an exercise is selected", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [makeExercise({ id: "ex-1" })];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    fireEvent.press(getByTestId("stub-select-exercise"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/exercises/ex-1");
  });

  it("navigates to the create route when onCreateExercise fires", async () => {
    const { adapters } = createTestAdapters();

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    fireEvent.press(getByTestId("stub-create-exercise"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/exercises/create");
  });

  it("handles non-Error thrown during refresh with a fallback message", async () => {
    const { adapters, api } = createTestAdapters();
    api.getExercises = async () => {
      throw "kaboom";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-load-error").props.children).toBe(
        "Refresh failed",
      );
    });
  });

  it("allows manual pull-to-refresh to repopulate the cache after failure recovery", async () => {
    const { adapters, api } = createTestAdapters();
    api.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-load-error").props.children).not.toBe("none");
    });

    // Recover the API and pull-to-refresh.
    api.shouldFail = false;
    api.exercises = [makeExercise({ id: "recovered" })];

    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
      expect(getByTestId("stub-load-error").props.children).toBe("none");
    });
  });
});
