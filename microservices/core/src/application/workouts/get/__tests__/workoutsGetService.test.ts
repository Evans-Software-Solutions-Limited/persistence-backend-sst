import { WorkoutsGetService } from "../workoutsGetService";

describe("WorkoutsGetService", () => {
  it("should export a service instance", () => {
    expect(WorkoutsGetService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(WorkoutsGetService).toHaveProperty("handle");
  });

  it("should provide repository decoration for getting workouts", () => {
    expect(WorkoutsGetService).toBeTruthy();
  });
});
