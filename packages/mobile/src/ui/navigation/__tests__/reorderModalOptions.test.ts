import { reorderModalOptions } from "../reorderModalOptions";

describe("reorderModalOptions", () => {
  it("disables the native dismiss gesture on exercise-reorder screens", () => {
    expect(reorderModalOptions).toEqual({
      presentation: "modal",
      headerShown: false,
      gestureEnabled: false,
    });
  });
});
