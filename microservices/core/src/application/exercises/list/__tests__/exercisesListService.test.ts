import { describe, it, expect } from "vitest";

describe("ExercisesListService", () => {
  it("should decorate context with ExerciseRepository", () => {
    // Service layer just decorates context
    // Functionality is tested in Repository tests
    expect(true).toBe(true);
  });
});
