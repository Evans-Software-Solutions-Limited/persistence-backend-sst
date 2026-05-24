import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { DevExerciseCreatorContainer } from "../DevExerciseCreatorContainer";

jest.setTimeout(15_000);

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

function createTestAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api,
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage };
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

describe("DevExerciseCreatorContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockClear();
  });

  it("renders all four select rows + the name input", () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <DevExerciseCreatorContainer />
      </TestWrapper>,
    );
    expect(getByTestId("dev-creator-name")).toBeTruthy();
    expect(getByTestId("dev-creator-muscle-chest")).toBeTruthy();
    expect(getByTestId("dev-creator-equipment-barbell")).toBeTruthy();
    expect(getByTestId("dev-creator-category-strength")).toBeTruthy();
    expect(getByTestId("dev-creator-difficulty-beginner")).toBeTruthy();
  });

  it("ignores submit presses until the name is at least 2 chars", async () => {
    const { adapters, storage } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <DevExerciseCreatorContainer />
      </TestWrapper>,
    );

    // Empty name — press is a no-op (no nav, no cache write).
    await act(async () => {
      fireEvent.press(getByTestId("dev-creator-submit"));
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(storage.getCachedExercises()).toHaveLength(0);

    // 1-char name — still below min, still a no-op.
    fireEvent.changeText(getByTestId("dev-creator-name"), "X");
    await act(async () => {
      fireEvent.press(getByTestId("dev-creator-submit"));
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(storage.getCachedExercises()).toHaveLength(0);

    // 2+ char name — press succeeds (validated elsewhere, just confirm
    // the gate lifts).
    fireEvent.changeText(getByTestId("dev-creator-name"), "Ab");
    await act(async () => {
      fireEvent.press(getByTestId("dev-creator-submit"));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("saves the exercise to the local cache and navigates back on submit", async () => {
    const { adapters, storage } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <DevExerciseCreatorContainer />
      </TestWrapper>,
    );

    fireEvent.changeText(getByTestId("dev-creator-name"), "Pike Push-Up");
    fireEvent.press(getByTestId("dev-creator-muscle-shoulders"));
    fireEvent.press(getByTestId("dev-creator-equipment-bodyweight"));

    await act(async () => {
      fireEvent.press(getByTestId("dev-creator-submit"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    const cached = storage.getCachedExercises();
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe("Pike Push-Up");
    expect(cached[0].primaryMuscleGroups).toEqual(["shoulders"]);
    expect(cached[0].equipment).toEqual(["bodyweight"]);
    expect(cached[0].id.startsWith("local-")).toBe(true);
    expect(cached[0].isCustom).toBe(true);
  });

  it("enqueues a POST /exercises sync mutation with snake_case payload", async () => {
    const { adapters, storage } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <DevExerciseCreatorContainer />
      </TestWrapper>,
    );

    fireEvent.changeText(getByTestId("dev-creator-name"), "Test Lift");
    await act(async () => {
      fireEvent.press(getByTestId("dev-creator-submit"));
    });

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].endpoint).toBe("/exercises");
    expect(pending[0].method).toBe("POST");
    // Payload must be the snake_case wire shape, not the domain shape.
    const payload = JSON.parse(pending[0].payload) as Record<string, unknown>;
    expect(payload.name).toBe("Test Lift");
    expect(payload).toHaveProperty("difficulty_level");
    expect(payload).toHaveProperty("primary_muscles");
    expect(payload).toHaveProperty("equipment_required");
    // Domain field names must NOT appear on the wire.
    expect(payload).not.toHaveProperty("difficulty");
    expect(payload).not.toHaveProperty("primaryMuscleGroups");
    expect(payload).not.toHaveProperty("equipment");
  });
});
