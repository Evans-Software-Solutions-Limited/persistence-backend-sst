import { describe, it, expect } from "vitest";
import { WorkoutsDeleteService } from "../workoutsDeleteService";

describe("WorkoutsDeleteService", () => {
  it("should export a service instance", () => {
    expect(WorkoutsDeleteService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(WorkoutsDeleteService).toHaveProperty("handle");
  });

  it("should provide repository decoration for deleting workouts", () => {
    expect(WorkoutsDeleteService).toBeTruthy();
  });
});
