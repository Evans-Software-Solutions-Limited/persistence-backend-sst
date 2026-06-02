import { useCreateExerciseSheet } from "@/state/createExerciseSheet";

describe("useCreateExerciseSheet", () => {
  beforeEach(() => {
    useCreateExerciseSheet.setState({ open: false });
  });

  it("starts closed", () => {
    expect(useCreateExerciseSheet.getState().open).toBe(false);
  });

  it("openSheet sets open true; closeSheet sets it false", () => {
    useCreateExerciseSheet.getState().openSheet();
    expect(useCreateExerciseSheet.getState().open).toBe(true);
    useCreateExerciseSheet.getState().closeSheet();
    expect(useCreateExerciseSheet.getState().open).toBe(false);
  });
});
