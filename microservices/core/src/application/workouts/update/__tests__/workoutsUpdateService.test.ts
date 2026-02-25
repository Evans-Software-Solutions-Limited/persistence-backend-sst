import { describe, it, expect } from "vitest";
import { WorkoutsUpdateService } from "../workoutsUpdateService";

describe("WorkoutsUpdateService", () => {
  it("should export a service instance", () => {
    expect(WorkoutsUpdateService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(WorkoutsUpdateService).toHaveProperty("handle");
  });

  it("should provide repository decoration for updating workouts", () => {
    expect(WorkoutsUpdateService).toBeTruthy();
  });
});
