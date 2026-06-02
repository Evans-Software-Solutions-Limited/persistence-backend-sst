import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";

describe("useExerciseLibrary", () => {
  beforeEach(() => {
    useExerciseLibrary.setState({ revision: 0 });
  });

  it("starts at revision 0", () => {
    expect(useExerciseLibrary.getState().revision).toBe(0);
  });

  it("increments the revision on each markChanged", () => {
    useExerciseLibrary.getState().markChanged();
    expect(useExerciseLibrary.getState().revision).toBe(1);
    useExerciseLibrary.getState().markChanged();
    expect(useExerciseLibrary.getState().revision).toBe(2);
  });
});
