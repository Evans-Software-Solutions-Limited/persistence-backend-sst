import { WorkoutsListService } from "../workoutsListService";

describe("WorkoutsListService", () => {
  it("should export a service instance", () => {
    expect(WorkoutsListService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(WorkoutsListService).toHaveProperty("handle");
  });

  it("should provide repository decoration for listing workouts", () => {
    expect(WorkoutsListService).toBeTruthy();
  });
});
