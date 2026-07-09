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

  it("shows a search action (not Create) on the Workouts segment", () => {
    const { getByLabelText, queryByText } = renderWithTheme(
      <TrainHubContainer />,
    );
    expect(getByLabelText("Search workouts")).toBeTruthy();
    expect(queryByText("Create")).toBeNull();
  });

  it("the Workouts-segment search action is pressable (no-op until 04 wires it)", () => {
    const { getByLabelText } = renderWithTheme(<TrainHubContainer />);
    // Placeholder handler — pressing must not throw or navigate.
    fireEvent.press(getByLabelText("Search workouts"));
    expect(mockPush).not.toHaveBeenCalled();
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
});
