import { fireEvent, within } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";

/**
 * TrainHubContainer tests.
 *
 * Spec: specs/14-navigation/design.md § <TrainHubContainer>
 *       specs/14-navigation/requirements.md STORY-005 (AC 5.1–5.6)
 * Closes: specs/14-navigation/tasks.md T-14.1.4 (Train hub integration half),
 *         STORY-009 AC 9.4.
 *
 * The list bodies (owned by 04-workout-management) are mocked to lightweight
 * markers — this suite asserts the hub's own behaviour: title/eyebrow,
 * contextual action per segment, segment switching + persistence, and the
 * pendingCreate deep-link one-shot.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    // Run the focus callback on mount (and whenever it changes), mirroring a
    // screen gaining focus. Honour any returned cleanup like the real hook.
    useFocusEffect: (cb: () => undefined | (() => void)) =>
      React.useEffect(cb, [cb]),
  };
});

jest.mock("@/ui/containers/WorkoutsListContainer", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    WorkoutsListContainer: () =>
      React.createElement(Text, { testID: "workouts-body" }, "Workouts body"),
  };
});

jest.mock("@/ui/containers/ExerciseListContainer", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    ExerciseListContainer: () =>
      React.createElement(Text, { testID: "exercises-body" }, "Exercises body"),
  };
});

jest.mock("@/ui/containers/TrainOverviewContainer", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    TrainOverviewContainer: () =>
      React.createElement(Text, { testID: "overview-body" }, "Overview body"),
  };
});

// Athlete "has an active coach" signal — drives the Training-segment gate.
// Default: one active coach, resolved (so the Training-tab tests below hold);
// the gate tests flip `current`/`loading`.
const activeCoaches: {
  current: { relationshipId: string }[];
  loading: boolean;
} = {
  current: [{ relationshipId: "rel-1" }],
  loading: false,
};
jest.mock("@/ui/hooks/useClientRelationships", () => ({
  useClientRelationships: () => ({
    data: activeCoaches.current,
    isLoading: activeCoaches.loading,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(),
    respond: jest.fn(),
    pendingIds: new Set<string>(),
  }),
}));

// eslint-disable-next-line import/first
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
// eslint-disable-next-line import/first
import { TrainHubContainer } from "@/ui/containers/TrainHubContainer";

const mockSetItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  mockPush.mockReset();
  mockSetItem.mockReset();
  mockSetItem.mockResolvedValue(undefined);
  // Default: the athlete has an active coach, resolved, so the Training segment
  // is available (the gate tests override this).
  activeCoaches.current = [{ relationshipId: "rel-1" }];
  activeCoaches.loading = false;
  // Reset the segment store to its default each test.
  useTrainSegment.setState({
    segment: "Workouts",
    pendingCreate: false,
    pendingSegment: null,
    hydrated: true,
  });
});

describe("TrainHubContainer", () => {
  it("leads with the Training overview (default segment) + no top-right action", () => {
    // The store default is now "Training" (M16); assert it here (beforeEach
    // pins the other tests to Workouts).
    useTrainSegment.setState({ segment: "Training", hydrated: true });
    const { getByTestId, queryByText, queryByLabelText } = renderWithTheme(
      <TrainHubContainer />,
    );
    const header = within(getByTestId("train-header"));
    expect(header.getByText("Training")).toBeTruthy();
    expect(getByTestId("overview-body")).toBeTruthy();
    // Training has neither the Create button nor the Workouts search action.
    expect(queryByText("Create")).toBeNull();
    expect(queryByLabelText("Search workouts")).toBeNull();
  });

  it("switches to Training from another segment", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <TrainHubContainer />,
    );
    fireEvent.press(getByTestId("train-segment-option-Training"));
    expect(getByTestId("overview-body")).toBeTruthy();
    expect(queryByTestId("workouts-body")).toBeNull();
  });

  it("renders the TRAIN eyebrow + Workouts title + workouts body by default", () => {
    const { getByTestId } = renderWithTheme(<TrainHubContainer />);
    const header = within(getByTestId("train-header"));
    expect(header.getByText("TRAIN")).toBeTruthy();
    expect(header.getByText("Workouts")).toBeTruthy();
    expect(getByTestId("workouts-body")).toBeTruthy();
  });

  it("shows neither Create nor a search action on the Workouts segment", () => {
    // Legacy has no header search icon on the workouts tab (it filtered via an
    // inline SearchBar), so the Workouts segment header carries no action.
    const { queryByLabelText, queryByText } = renderWithTheme(
      <TrainHubContainer />,
    );
    expect(queryByLabelText("Search workouts")).toBeNull();
    expect(queryByText("Create")).toBeNull();
  });

  it("switches to Exercises: title, body, Create action + persists the segment", () => {
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <TrainHubContainer />,
    );

    fireEvent.press(getByTestId("train-segment-option-Exercises"));

    const header = within(getByTestId("train-header"));
    expect(header.getByText("Exercises")).toBeTruthy();
    expect(getByTestId("exercises-body")).toBeTruthy();
    expect(queryByTestId("workouts-body")).toBeNull();
    expect(getByText("Create")).toBeTruthy();
    expect(mockSetItem).toHaveBeenCalledWith(
      "persistence.train.segment",
      "Exercises",
    );
  });

  it("Create on the Exercises segment pushes the full-screen create route", () => {
    useTrainSegment.setState({ segment: "Exercises", hydrated: true });
    const { getByText } = renderWithTheme(<TrainHubContainer />);

    fireEvent.press(getByText("Create"));

    expect(mockPush).toHaveBeenCalledWith("/(app)/exercises/create");
  });

  // §1: the Home "View all" one-shot. The hub was last on Exercises (the
  // freeze-on-blur frame); a pending "Workouts" must win on focus and the
  // one-shot must be consumed so it doesn't fight a later manual toggle.
  it("consumes a pending segment on focus and lands on Workouts", () => {
    useTrainSegment.setState({
      segment: "Exercises",
      pendingSegment: "Workouts",
      hydrated: true,
    });

    const { getByTestId, queryByTestId } = renderWithTheme(
      <TrainHubContainer />,
    );

    const header = within(getByTestId("train-header"));
    expect(header.getByText("Workouts")).toBeTruthy();
    expect(getByTestId("workouts-body")).toBeTruthy();
    expect(queryByTestId("exercises-body")).toBeNull();
    // One-shot drained.
    expect(useTrainSegment.getState().pendingSegment).toBeNull();
  });

  it("leaves the manual segment alone on focus when no pending is set", () => {
    // Manual toggle to Exercises with no pending one-shot — an ordinary
    // re-focus must NOT snap back to Workouts.
    useTrainSegment.setState({
      segment: "Exercises",
      pendingSegment: null,
      hydrated: true,
    });

    const { getByTestId } = renderWithTheme(<TrainHubContainer />);

    const header = within(getByTestId("train-header"));
    expect(header.getByText("Exercises")).toBeTruthy();
    expect(getByTestId("exercises-body")).toBeTruthy();
  });

  // A2 — Training-segment gate. The "Training" segment (coach-assigned work) is
  // only meaningful for athletes who actually have a coach.
  it("hides the Training tab when the athlete has no active coach", () => {
    activeCoaches.current = [];
    const { getByTestId, queryByTestId } = renderWithTheme(
      <TrainHubContainer />,
    );

    // Workouts + Exercises remain; Training is gone.
    expect(getByTestId("train-segment-option-Workouts")).toBeTruthy();
    expect(getByTestId("train-segment-option-Exercises")).toBeTruthy();
    expect(queryByTestId("train-segment-option-Training")).toBeNull();
  });

  it("redirects a persisted/default Training segment to Workouts with no coach", () => {
    activeCoaches.current = [];
    useTrainSegment.setState({ segment: "Training", hydrated: true });

    const { getByTestId, queryByTestId } = renderWithTheme(
      <TrainHubContainer />,
    );

    // Body + title fall back to Workouts, not the empty Training overview.
    const header = within(getByTestId("train-header"));
    expect(header.getByText("Workouts")).toBeTruthy();
    expect(getByTestId("workouts-body")).toBeTruthy();
    expect(queryByTestId("overview-body")).toBeNull();
    // The redirect is persisted so later launches land on Workouts directly.
    expect(mockSetItem).toHaveBeenCalledWith(
      "persistence.train.segment",
      "Workouts",
    );
  });

  it("keeps the Training tab when the athlete has an active coach", () => {
    activeCoaches.current = [{ relationshipId: "rel-1" }];
    useTrainSegment.setState({ segment: "Training", hydrated: true });

    const { getByTestId } = renderWithTheme(<TrainHubContainer />);

    expect(getByTestId("train-segment-option-Training")).toBeTruthy();
    expect(getByTestId("overview-body")).toBeTruthy();
  });

  // Regression: while the (network-only, uncached) coach signal is still
  // loading, a coached athlete's `data` is momentarily [] — identical to a
  // no-coach athlete. Treating that as "no coach" would yank them off Training
  // AND persist the demotion. The gate must keep Training (and NOT persist)
  // until the signal resolves.
  it("keeps Training and does not persist a redirect while the coach signal is loading", () => {
    activeCoaches.current = [];
    activeCoaches.loading = true;
    useTrainSegment.setState({ segment: "Training", hydrated: true });

    const { getByTestId } = renderWithTheme(<TrainHubContainer />);

    expect(getByTestId("train-segment-option-Training")).toBeTruthy();
    expect(getByTestId("overview-body")).toBeTruthy();
    expect(mockSetItem).not.toHaveBeenCalledWith(
      "persistence.train.segment",
      "Workouts",
    );
  });
});
