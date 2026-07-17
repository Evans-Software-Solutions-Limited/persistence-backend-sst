import { fireEvent, within } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";

/**
 * CoachLibraryHubContainer tests.
 *
 * Spec: specs/24-coach-authoring/design.md § B.1, § B.6
 *       specs/24-coach-authoring/requirements.md STORY-001 (AC 1.1, 1.5–1.7),
 *       STORY-002 (AC 2.1)
 *
 * The three bodies are mocked to lightweight markers — this suite asserts the
 * hub's own behaviour: eyebrow/title, segment-aware contextual action routing,
 * segment switching + persistence, and the `embedded` pass-through to the
 * Workouts body. Mirrors TrainHubContainer.test.tsx.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const mockCoachWorkoutLibraryContainer = jest.fn();
jest.mock("@/ui/containers/ProgramsListContainer", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    ProgramsListContainer: () =>
      React.createElement(
        Text,
        { testID: "programmes-body" },
        "Programmes body",
      ),
  };
});

jest.mock("@/ui/containers/CoachWorkoutLibraryContainer", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    CoachWorkoutLibraryContainer: (props: Record<string, unknown>) => {
      mockCoachWorkoutLibraryContainer(props);
      return React.createElement(
        Text,
        { testID: "workouts-body" },
        "Workouts body",
      );
    },
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
import { useCoachLibrarySegment } from "@/ui/hooks/useCoachLibrarySegment";
// eslint-disable-next-line import/first
import { CoachLibraryHubContainer } from "@/ui/containers/CoachLibraryHubContainer";

const mockSetItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  mockPush.mockReset();
  mockCoachWorkoutLibraryContainer.mockReset();
  mockSetItem.mockReset();
  mockSetItem.mockResolvedValue(undefined);
  // Reset the segment store to its default each test.
  useCoachLibrarySegment.setState({ segment: "Programmes", hydrated: true });
});

describe("CoachLibraryHubContainer", () => {
  it("renders the LIBRARY eyebrow + Programmes title + programmes body by default", () => {
    const { getByTestId } = renderWithTheme(<CoachLibraryHubContainer />);
    const header = within(getByTestId("coach-library-header"));
    expect(header.getByText("LIBRARY")).toBeTruthy();
    expect(header.getByText("Programmes")).toBeTruthy();
    expect(getByTestId("programmes-body")).toBeTruthy();
  });

  it("shows the 'New programme' contextual action on the Programmes segment", () => {
    const { getByText } = renderWithTheme(<CoachLibraryHubContainer />);
    expect(getByText("New programme")).toBeTruthy();
  });

  it("New programme pushes the programme create route", () => {
    const { getByText } = renderWithTheme(<CoachLibraryHubContainer />);
    fireEvent.press(getByText("New programme"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/create");
  });

  it("switches back to Programmes from another segment", () => {
    useCoachLibrarySegment.setState({ segment: "Exercises", hydrated: true });
    const { getByTestId, queryByTestId } = renderWithTheme(
      <CoachLibraryHubContainer />,
    );
    fireEvent.press(getByTestId("coach-library-segment-option-Programmes"));
    expect(getByTestId("programmes-body")).toBeTruthy();
    expect(queryByTestId("exercises-body")).toBeNull();
  });

  it("switches to Workouts: title, body (embedded), contextual action + persists the segment", () => {
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <CoachLibraryHubContainer />,
    );

    fireEvent.press(getByTestId("coach-library-segment-option-Workouts"));

    const header = within(getByTestId("coach-library-header"));
    expect(header.getByText("Workouts")).toBeTruthy();
    expect(getByTestId("workouts-body")).toBeTruthy();
    expect(queryByTestId("programmes-body")).toBeNull();
    expect(getByText("Create workout")).toBeTruthy();
    expect(mockSetItem).toHaveBeenCalledWith(
      "persistence.coach.library.segment",
      "Workouts",
    );
    // The Workouts body is rendered embedded — the hub owns chrome.
    expect(mockCoachWorkoutLibraryContainer).toHaveBeenCalledWith(
      expect.objectContaining({ embedded: true }),
    );
  });

  it("Create workout pushes the workout create route with coach ctx", () => {
    useCoachLibrarySegment.setState({ segment: "Workouts", hydrated: true });
    const { getByText } = renderWithTheme(<CoachLibraryHubContainer />);
    fireEvent.press(getByText("Create workout"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/create?ctx=coach");
  });

  it("switches to Exercises: title, body, contextual action + persists the segment", () => {
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <CoachLibraryHubContainer />,
    );

    fireEvent.press(getByTestId("coach-library-segment-option-Exercises"));

    const header = within(getByTestId("coach-library-header"));
    expect(header.getByText("Exercises")).toBeTruthy();
    expect(getByTestId("exercises-body")).toBeTruthy();
    expect(queryByTestId("programmes-body")).toBeNull();
    expect(getByText("Create")).toBeTruthy();
    expect(mockSetItem).toHaveBeenCalledWith(
      "persistence.coach.library.segment",
      "Exercises",
    );
  });

  it("Create pushes the exercise create route on the Exercises segment", () => {
    useCoachLibrarySegment.setState({ segment: "Exercises", hydrated: true });
    const { getByText } = renderWithTheme(<CoachLibraryHubContainer />);
    fireEvent.press(getByText("Create"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/exercises/create");
  });
});
