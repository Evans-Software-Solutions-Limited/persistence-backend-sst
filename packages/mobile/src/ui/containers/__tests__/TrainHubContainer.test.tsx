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
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

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

// eslint-disable-next-line import/first
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
// eslint-disable-next-line import/first
import { useCreateExerciseSheet } from "@/state/createExerciseSheet";
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
    hydrated: true,
  });
  useCreateExerciseSheet.setState({ open: false });
});

describe("TrainHubContainer", () => {
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

  it("Create on the Exercises segment opens the create sheet", () => {
    useTrainSegment.setState({ segment: "Exercises", hydrated: true });
    const { getByText } = renderWithTheme(<TrainHubContainer />);

    expect(useCreateExerciseSheet.getState().open).toBe(false);
    fireEvent.press(getByText("Create"));

    // The sheet is mounted at the root layout; the hub just flips the store.
    expect(useCreateExerciseSheet.getState().open).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
