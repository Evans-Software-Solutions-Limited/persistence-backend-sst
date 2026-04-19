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
import { ExerciseFiltersProvider } from "@/ui/hooks/useExerciseFilters";
import config from "../../../../tamagui.config";
import { ExerciseListContainer } from "../ExerciseListContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/ExerciseListPresenter");
const MockPresenter = jest.mocked(ExerciseListPresenter);

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
        testID="stub-toggle-beginner"
        onPress={() => props.onToggleQuickFilter("beginner")}
      />
      <Pressable
        testID="stub-toggle-advanced"
        onPress={() => props.onToggleQuickFilter("advanced")}
      />
      <Pressable
        testID="stub-toggle-mine"
        onPress={() => props.onToggleQuickFilter("mine")}
      />
      <Pressable
        testID="stub-toggle-system"
        onPress={() => props.onToggleQuickFilter("system")}
      />
      <Pressable
        testID="stub-toggle-all"
        onPress={() => props.onToggleQuickFilter("all")}
      />
      <Pressable testID="stub-open-filters" onPress={props.onOpenFilterModal} />
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
      <Text testID="stub-has-any-filter">
        {props.hasAnyFilter ? "true" : "false"}
      </Text>
      <Text testID="stub-quick-filters">
        {props.selectedQuickFilters.join(",")}
      </Text>
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
        <AdapterProvider adapters={adapters}>
          <ExerciseFiltersProvider>{children}</ExerciseFiltersProvider>
        </AdapterProvider>
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
  });

  it("starts in 'All' quick-filter state with no active filters", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [makeExercise()];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });
    expect(getByTestId("stub-quick-filters").props.children).toBe("all");
    expect(getByTestId("stub-has-any-filter").props.children).toBe("false");
  });

  it("toggling a difficulty pill filters the list and deselects 'all'", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [
      makeExercise({ id: "a", name: "A", difficulty: "beginner" }),
      makeExercise({ id: "b", name: "B", difficulty: "advanced" }),
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
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });
    expect(getByTestId("stub-quick-filters").props.children).toBe("beginner");
  });

  it("OR-matches multiple difficulty pills on the same axis", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [
      makeExercise({ id: "a", difficulty: "beginner" }),
      makeExercise({ id: "b", difficulty: "advanced" }),
      makeExercise({ id: "c", difficulty: "intermediate" }),
    ];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(3);
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-advanced"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });
  });

  it("'mine' and 'system' pills are mutually exclusive", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [
      makeExercise({ id: "sys", isCustom: false }),
      makeExercise({ id: "mine", isCustom: true, createdBy: "me" }),
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
      fireEvent.press(getByTestId("stub-toggle-mine"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(1);
    });

    // Selecting system replaces mine (mutual exclusion on createdBy axis).
    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-system"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-quick-filters").props.children).toBe("system");
      expect(getByTestId("stub-count").props.children).toBe(1);
    });
  });

  it("'all' is mutually exclusive and resets other selections", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [makeExercise()];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-advanced"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-quick-filters").props.children).toBe(
        "beginner,advanced",
      );
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-all"));
    });
    await waitFor(() => {
      expect(getByTestId("stub-quick-filters").props.children).toBe("all");
    });
  });

  it("deselecting the last non-'all' pill falls back to 'all'", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [makeExercise()];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-quick-filters").props.children).toBe("all");
    });
  });

  it("clears everything when onClearFilters fires", async () => {
    const { adapters, api } = createTestAdapters();
    api.exercises = [makeExercise()];

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
      fireEvent.changeText(getByTestId("stub-search"), "squat");
    });

    await waitFor(() => {
      expect(getByTestId("stub-has-any-filter").props.children).toBe("true");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-clear"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-quick-filters").props.children).toBe("all");
      expect(getByTestId("stub-has-any-filter").props.children).toBe("false");
    });
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
    // Before debounce elapses, full list still visible.
    expect(getByTestId("stub-count").props.children).toBe(2);

    await waitFor(
      () => {
        expect(getByTestId("stub-count").props.children).toBe(1);
      },
      { timeout: 2000, interval: 50 },
    );
  });

  it("surfaces loadError when refresh fails and there is no cached data", async () => {
    const { adapters, api } = createTestAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-load-error").props.children).toBe("boom");
    });
  });

  it("keeps cached exercises visible when a later refresh fails", async () => {
    const { adapters, api, storage } = createTestAdapters();
    storage.cacheExercises([makeExercise({ id: "seed" })]);
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

    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    await waitFor(() => {
      expect(lastProps?.isRefreshing).toBe(false);
    });
    expect(getByTestId("stub-count").props.children).toBe(1);
    expect(getByTestId("stub-load-error").props.children).toBe("none");
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

  it("navigates to the filters modal when onOpenFilterModal fires", async () => {
    const { adapters } = createTestAdapters();

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ExerciseListContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("presenter-stub")).toBeTruthy();
    });

    fireEvent.press(getByTestId("stub-open-filters"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/exercises/filters");
  });
});
