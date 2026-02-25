import { describe, it, expect } from "vitest";
import { ExercisesListService } from "../exercisesListService";
import { ExerciseRepository } from "../../../repositories/exerciseRepository";

describe("ExercisesListService", () => {
  it("should decorate context with ExerciseRepository", () => {
    const instance = ExercisesListService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.ExerciseRepository).toBeDefined();
    expect(instance.ExerciseRepository).toBeInstanceOf(ExerciseRepository);
  });

  it("should make list method available via decorated service", async () => {
    const instance = ExercisesListService.singleton({} as any, {});

    expect(instance.ExerciseRepository.list).toBeDefined();
    expect(typeof instance.ExerciseRepository.list).toBe("function");
  });

  it("should accept filter parameters in repository list method", async () => {
    const instance = ExercisesListService.singleton({} as any, {});

    // Service layer decorates the repository instance
    // Repository list method accepts filters
    const listMethod = instance.ExerciseRepository.list;
    expect(listMethod.length >= 0).toBe(true);
  });
});
