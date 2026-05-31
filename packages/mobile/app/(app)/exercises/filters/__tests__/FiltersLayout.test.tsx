import { fireEvent, render } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * Filters-modal layout (Apply) tests.
 *
 * Spec: specs/03-exercise-library/design.md § Hierarchical Filter Modal
 *       specs/14-navigation/design.md § Route migration table
 * Covers: review #93 — Apply must dismiss to the Train hub's Exercises
 * segment (the standalone `(tabs)/exercises` route was removed under the
 * Option 3 IA), not to a now-deleted route.
 */

// Mock expo-router: capture dismissTo + render Stack/Stack.Screen as
// passthroughs (we only exercise the sticky Apply bar, which lives outside
// the Stack).
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  function Stack(props: { children?: React.ReactNode }) {
    // The real Stack only renders its matched screen; for this test the body
    // we assert on is the sticky Apply bar rendered as a sibling, so the Stack
    // children (per-axis screens) can be dropped.
    void props;
    return React.createElement(View, { testID: "filters-stack" });
  }
  Stack.displayName = "MockStack";
  Stack.Screen = function StackScreen() {
    return null;
  };
  return {
    Stack,
    useRouter: () => ({ dismissTo: mockDismissTo, back: mockBack }),
  };
});

// eslint-disable-next-line import/first
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
// eslint-disable-next-line import/first
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
// eslint-disable-next-line import/first
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
// eslint-disable-next-line import/first
import { StubHealthAdapter } from "@/adapters/health";
// eslint-disable-next-line import/first
import { StubNotificationsAdapter } from "@/adapters/notifications";
// eslint-disable-next-line import/first
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
// eslint-disable-next-line import/first
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { ExerciseFiltersProvider } from "@/ui/hooks/useExerciseFilters";
// eslint-disable-next-line import/first
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
// eslint-disable-next-line import/first
import config from "../../../../../tamagui.config";
// eslint-disable-next-line import/first
import FiltersLayout from "../_layout";

function makeAdapters(): Adapters {
  return {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
}

function renderLayout() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <AdapterProvider adapters={makeAdapters()}>
          <ExerciseFiltersProvider>
            <FiltersLayout />
          </ExerciseFiltersProvider>
        </AdapterProvider>
      </TamaguiProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockDismissTo.mockReset();
  mockBack.mockReset();
  useTrainSegment.setState({ segment: "Workouts", pendingCreate: false });
});

describe("FiltersLayout — Apply (review #93)", () => {
  it("dismisses to the Train hub, not the deleted (tabs)/exercises route", () => {
    const { getByTestId } = renderLayout();
    fireEvent.press(getByTestId("filters-apply-button"));
    expect(mockDismissTo).toHaveBeenCalledWith("/(app)/(tabs)/train");
    // Guard against a regression back to the removed standalone route.
    expect(mockDismissTo).not.toHaveBeenCalledWith("/(app)/(tabs)/exercises");
  });

  it("seeds the Train segment to Exercises so the user lands on the right hub view", () => {
    const { getByTestId } = renderLayout();
    expect(useTrainSegment.getState().segment).toBe("Workouts");
    fireEvent.press(getByTestId("filters-apply-button"));
    expect(useTrainSegment.getState().segment).toBe("Exercises");
  });
});
