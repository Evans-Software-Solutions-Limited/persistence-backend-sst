import { ExercisesListService } from "../exercisesListService";

describe("ExercisesListService", () => {
  it("should export a service instance", () => {
    expect(ExercisesListService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(ExercisesListService).toHaveProperty("handle");
  });

  it("should provide repository decoration for listing exercises", () => {
    expect(ExercisesListService).toBeTruthy();
  });
});
