import { fireEvent } from "@testing-library/react-native";

import type { Exercise } from "@/domain/models/exercise";
import { ExerciseDetailPresenter } from "@/ui/presenters/ExerciseDetailPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const exercise: Exercise = {
  id: "ex-1",
  name: "Incline Bench Press",
  description: "A chest builder",
  instructions: "Set the bench to 30 degrees",
  category: "strength",
  difficulty: "advanced",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["triceps"],
  equipment: ["barbell"],
  primaryMuscleGroupLabels: ["Chest"],
  secondaryMuscleGroupLabels: ["Triceps", ""],
  equipmentLabels: ["Barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "user-1",
};

function setup(
  overrides: Partial<React.ComponentProps<typeof ExerciseDetailPresenter>> = {},
) {
  const props = {
    exercise,
    isLoading: false,
    error: null,
    isOwner: true,
    onClose: jest.fn(),
    onEdit: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
  return { props, ...renderWithTheme(<ExerciseDetailPresenter {...props} />) };
}

describe("ExerciseDetailPresenter", () => {
  it("renders the name, level, description, sections and instructions", () => {
    const { getByText, getByTestId } = setup();
    expect(getByText("Incline Bench Press")).toBeTruthy();
    expect(getByText("Advanced")).toBeTruthy();
    expect(getByText("A chest builder")).toBeTruthy();
    expect(getByTestId("exercise-detail-primary")).toBeTruthy();
    expect(getByTestId("exercise-detail-secondary")).toBeTruthy();
    expect(getByTestId("exercise-detail-equipment")).toBeTruthy();
    expect(getByText("Set the bench to 30 degrees")).toBeTruthy();
  });

  it("shows the Edit button only for the owner", () => {
    const { queryByTestId } = setup({ isOwner: true });
    expect(queryByTestId("exercise-detail-edit")).toBeTruthy();
  });

  it("hides the Edit button for non-owners", () => {
    const { queryByTestId } = setup({ isOwner: false });
    expect(queryByTestId("exercise-detail-edit")).toBeNull();
  });

  it("fires onEdit / onClose from the header actions", () => {
    const { props, getByTestId, getByLabelText } = setup();
    fireEvent.press(getByTestId("exercise-detail-edit"));
    expect(props.onEdit).toHaveBeenCalled();
    fireEvent.press(getByLabelText("Back"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders the photo when a thumbnailUrl is present, placeholder otherwise", () => {
    const withPhoto = setup({
      exercise: { ...exercise, thumbnailUrl: "https://x/y.png" },
    });
    expect(withPhoto.queryByTestId("exercise-detail-photo")).toBeTruthy();
    expect(
      withPhoto.queryByTestId("exercise-detail-photo-placeholder"),
    ).toBeNull();

    const noPhoto = setup();
    expect(
      noPhoto.queryByTestId("exercise-detail-photo-placeholder"),
    ).toBeTruthy();
    expect(noPhoto.queryByTestId("exercise-detail-photo")).toBeNull();
  });

  it("omits empty sections (no resolved labels, no description/instructions)", () => {
    const { queryByTestId, queryByText } = setup({
      exercise: {
        ...exercise,
        description: null,
        instructions: null,
        primaryMuscleGroupLabels: [],
        secondaryMuscleGroupLabels: ["", ""],
        equipmentLabels: undefined,
      },
    });
    expect(queryByTestId("exercise-detail-primary")).toBeNull();
    expect(queryByTestId("exercise-detail-secondary")).toBeNull();
    expect(queryByTestId("exercise-detail-equipment")).toBeNull();
    expect(queryByText("DESCRIPTION")).toBeNull();
    expect(queryByText("INSTRUCTIONS")).toBeNull();
  });

  it("renders the loading state when loading with no exercise", () => {
    const { getByTestId } = setup({ exercise: null, isLoading: true });
    expect(getByTestId("exercise-detail-loading")).toBeTruthy();
  });

  it("renders the error state with a retry that fires onRetry", () => {
    const { props, getByTestId } = setup({
      exercise: null,
      error: { kind: "api", code: "server", message: "Network down" },
    });
    expect(getByTestId("exercise-detail-error")).toBeTruthy();
    fireEvent.press(getByTestId("exercise-detail-retry"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("renders the not-found empty state when there's no exercise, error or load", () => {
    const { getByTestId } = setup({ exercise: null });
    expect(getByTestId("exercise-detail-empty")).toBeTruthy();
  });
});
