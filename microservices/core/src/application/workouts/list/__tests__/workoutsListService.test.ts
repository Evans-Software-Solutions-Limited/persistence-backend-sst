import { describe, it, expect } from "vitest";
import { WorkoutsListService } from "../workoutsListService";
import { WorkoutRepository } from "../../../../repositories/workoutRepository";

describe("WorkoutsListService", () => {
  it("should decorate context with WorkoutRepository", async () => {
    const instance = WorkoutsListService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.WorkoutRepository).toBeDefined();
    expect(instance.WorkoutRepository).toBeInstanceOf(WorkoutRepository);
  });

  it("should provide list method via decorated service", async () => {
    const instance = WorkoutsListService.singleton({} as any, {});

    expect(instance.WorkoutRepository.list).toBeDefined();
    expect(typeof instance.WorkoutRepository.list).toBe("function");
  });

  it("should have WorkoutRepository properly decorated", async () => {
    const instance = WorkoutsListService.singleton({} as any, {});

    const repo = instance.WorkoutRepository;
    expect(repo.list).toBeDefined();
  });
});
