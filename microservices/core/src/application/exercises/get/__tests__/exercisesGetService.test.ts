import { describe, it, expect } from "vitest";
import { ExercisesGetService } from "../exercisesGetService";
import { ExerciseRepository } from "../../../repositories/exerciseRepository";

describe("ExercisesGetService", () => {
  it("should provide ExerciseRepository as a decorated service", async () => {
    const instance = ExercisesGetService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.ExerciseRepository).toBeDefined();
    expect(instance.ExerciseRepository).toBeInstanceOf(ExerciseRepository);
  });

  it("should have ExerciseRepository with list method", async () => {
    const instance = ExercisesGetService.singleton({} as any, {});

    expect(instance.ExerciseRepository.list).toBeDefined();
    expect(typeof instance.ExerciseRepository.list).toBe("function");
  });

  it("should have ExerciseRepository with getById method", async () => {
    const instance = ExercisesGetService.singleton({} as any, {});

    expect(instance.ExerciseRepository.getById).toBeDefined();
    expect(typeof instance.ExerciseRepository.getById).toBe("function");
  });
});
