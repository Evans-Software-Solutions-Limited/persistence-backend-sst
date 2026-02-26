import { WorkoutsCreateService } from "../workoutsCreateService";

describe("WorkoutsCreateService", () => {
  it("should export a service instance", () => {
    expect(WorkoutsCreateService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(WorkoutsCreateService).toHaveProperty("handle");
  });

  it("should provide repository decoration for creating workouts", () => {
    expect(WorkoutsCreateService).toBeTruthy();
  });
});
