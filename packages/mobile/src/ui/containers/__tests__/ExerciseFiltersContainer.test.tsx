import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Exercise } from "@/domain/models/exercise";
import type { Adapters } from "@/shared/types";
import { ExerciseFiltersPresenter } from "@/ui/presenters/ExerciseFiltersPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  ExerciseFiltersProvider,
  useExerciseFilters,
} from "@/ui/hooks/useExerciseFilters";
import config from "../../../../tamagui.config";
import { ExerciseFiltersContainer } from "../ExerciseFiltersContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/ExerciseFiltersPresenter");
const MockPresenter = jest.mocked(ExerciseFiltersPresenter);

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

let lastProps: Parameters<typeof ExerciseFiltersPresenter>[0] | null = null;

MockPresenter.mockImplementation((props) => {
  lastProps = props;
  return (
    <View testID="modal-stub">
      <Text testID="stub-count">{props.matchCount}</Text>
      <Text testID="stub-difficulties">{props.difficulties.join(",")}</Text>
      <Text testID="stub-equipment">{props.equipment.join(",")}</Text>
      <Text testID="stub-muscles">{props.muscleGroups.join(",")}</Text>
      <Pressable
        testID="stub-toggle-beginner"
        onPress={() => props.onToggleDifficulty("beginner")}
      />
      <Pressable
        testID="stub-toggle-barbell"
        onPress={() => props.onToggleEquipment("barbell")}
      />
      <Pressable
        testID="stub-toggle-chest"
        onPress={() => props.onToggleMuscleGroup("chest")}
      />
      <Pressable testID="stub-clear" onPress={props.onClear} />
      <Pressable testID="stub-apply" onPress={props.onApply} />
      <Pressable testID="stub-close" onPress={props.onClose} />
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

function seedStorage(exercises: Exercise[]): InMemoryStorageAdapter {
  const storage = new InMemoryStorageAdapter();
  storage.cacheExercises(exercises);
  storage.setLastSyncedAt("exercises", new Date().toISOString());
  return storage;
}

function createAdapters(storage: InMemoryStorageAdapter): Adapters {
  return {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new StubPaymentsAdapter(),
  };
}

/** Tiny utility so tests can peek at the shared context after Apply. */
function FiltersProbe({ onUpdate }: { onUpdate: (value: unknown) => void }) {
  const value = useExerciseFilters();
  onUpdate(value);
  return null;
}

function TestWrapper({
  adapters,
  onContextUpdate,
  children,
}: {
  adapters: Adapters;
  onContextUpdate?: (value: unknown) => void;
  children: ReactNode;
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
          <ExerciseFiltersProvider>
            {onContextUpdate && <FiltersProbe onUpdate={onContextUpdate} />}
            {children}
          </ExerciseFiltersProvider>
        </AdapterProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

describe("ExerciseFiltersContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastProps = null;
    mockBack.mockClear();
  });

  it("initialises pending state as empty when no advanced filters applied", async () => {
    const storage = seedStorage([makeExercise()]);
    const { getByTestId } = render(
      <TestWrapper adapters={createAdapters(storage)}>
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });
    expect(getByTestId("stub-difficulties").props.children).toBe("");
    expect(getByTestId("stub-equipment").props.children).toBe("");
    expect(getByTestId("stub-muscles").props.children).toBe("");
  });

  it("toggling a chip updates pending state locally without committing", async () => {
    const storage = seedStorage([
      makeExercise({ id: "a", difficulty: "beginner" }),
      makeExercise({ id: "b", difficulty: "advanced" }),
    ]);
    type Ctx = {
      difficultiesAdvanced: string[];
      equipment: string[];
      muscleGroups: string[];
    };
    let lastContext: Ctx | null = null;

    const { getByTestId } = render(
      <TestWrapper
        adapters={createAdapters(storage)}
        onContextUpdate={(v) => (lastContext = v as Ctx)}
      >
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });

    expect(getByTestId("stub-difficulties").props.children).toBe("beginner");
    // Shared context was NOT touched — commit happens on Apply only.
    const ctx = lastContext as Ctx | null;
    expect(ctx?.difficultiesAdvanced).toEqual([]);
  });

  it("Apply commits pending state into the shared context and navigates back", async () => {
    const storage = seedStorage([
      makeExercise({ id: "a", difficulty: "beginner" }),
      makeExercise({ id: "b", difficulty: "advanced" }),
    ]);
    type Ctx = {
      difficultiesAdvanced: string[];
      equipment: string[];
      muscleGroups: string[];
    };
    let lastContext: Ctx | null = null;

    const { getByTestId } = render(
      <TestWrapper
        adapters={createAdapters(storage)}
        onContextUpdate={(v) => (lastContext = v as Ctx)}
      >
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
      fireEvent.press(getByTestId("stub-toggle-barbell"));
      fireEvent.press(getByTestId("stub-toggle-chest"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-apply"));
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    const ctx = lastContext as Ctx | null;
    expect(ctx?.difficultiesAdvanced).toEqual(["beginner"]);
    expect(ctx?.equipment).toEqual(["barbell"]);
    expect(ctx?.muscleGroups).toEqual(["chest"]);
  });

  it("Close dismisses without committing", async () => {
    const storage = seedStorage([makeExercise()]);
    type Ctx = { difficultiesAdvanced: string[] };
    let lastContext: Ctx | null = null;

    const { getByTestId } = render(
      <TestWrapper
        adapters={createAdapters(storage)}
        onContextUpdate={(v) => (lastContext = v as Ctx)}
      >
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
      fireEvent.press(getByTestId("stub-close"));
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    const ctx = lastContext as Ctx | null;
    expect(ctx?.difficultiesAdvanced).toEqual([]);
  });

  it("Clear resets pending state locally (does not commit)", async () => {
    const storage = seedStorage([makeExercise()]);

    const { getByTestId } = render(
      <TestWrapper adapters={createAdapters(storage)}>
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
      fireEvent.press(getByTestId("stub-toggle-barbell"));
    });

    expect(getByTestId("stub-difficulties").props.children).toBe("beginner");

    await act(async () => {
      fireEvent.press(getByTestId("stub-clear"));
    });

    expect(getByTestId("stub-difficulties").props.children).toBe("");
    expect(getByTestId("stub-equipment").props.children).toBe("");
  });

  it("matchCount reflects the count after applying pending filters to the cache", async () => {
    const storage = seedStorage([
      makeExercise({ id: "a", difficulty: "beginner" }),
      makeExercise({ id: "b", difficulty: "beginner" }),
      makeExercise({ id: "c", difficulty: "advanced" }),
    ]);

    const { getByTestId } = render(
      <TestWrapper adapters={createAdapters(storage)}>
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(3);
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-beginner"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-count").props.children).toBe(2);
    });
  });

  it("toggling the same pill twice deselects it", async () => {
    const storage = seedStorage([
      makeExercise({ equipment: ["barbell"] }),
      makeExercise({ id: "c", equipment: ["cable"] }),
    ]);

    const { getByTestId } = render(
      <TestWrapper adapters={createAdapters(storage)}>
        <ExerciseFiltersContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("modal-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-barbell"));
    });
    expect(getByTestId("stub-equipment").props.children).toBe("barbell");

    await act(async () => {
      fireEvent.press(getByTestId("stub-toggle-barbell"));
    });
    expect(getByTestId("stub-equipment").props.children).toBe("");
    // lastProps should never have been null after render
    expect(lastProps).not.toBeNull();
  });
});
