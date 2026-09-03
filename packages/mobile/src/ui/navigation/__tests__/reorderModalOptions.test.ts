import { reorderModalOptions } from "../reorderModalOptions";

describe("reorderModalOptions", () => {
  it("disables the native dismiss gesture on exercise-reorder screens", () => {
    expect(reorderModalOptions).toEqual({
      presentation: "fullScreenModal",
      headerShown: false,
      gestureEnabled: false,
    });
  });
});
