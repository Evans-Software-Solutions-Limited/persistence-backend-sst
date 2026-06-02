import { useCreateExerciseSheet } from "@/state/createExerciseSheet";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

// eslint-disable-next-line import/first
import CreateExerciseRedirect from "../create";

describe("/exercises/create redirect stub", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    useTrainSegment.setState({ segment: "Workouts", pendingCreate: false });
    useCreateExerciseSheet.setState({ open: false });
  });

  it("switches to Exercises, opens the create sheet, and replaces with the Train tab", () => {
    renderWithTheme(<CreateExerciseRedirect />);

    expect(useTrainSegment.getState().segment).toBe("Exercises");
    expect(useCreateExerciseSheet.getState().open).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/train");
  });
});
