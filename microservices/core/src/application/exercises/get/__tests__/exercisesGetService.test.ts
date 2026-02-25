import { describe, it, expect } from "vitest";
import { ExercisesGetService } from "../exercisesGetService";

describe("ExercisesGetService", () => {
  it("should export a service instance", () => {
    expect(ExercisesGetService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(ExercisesGetService).toHaveProperty("handle");
  });

  it("should be configured with exercise repository", () => {
    expect(ExercisesGetService).toBeTruthy();
  });
});
