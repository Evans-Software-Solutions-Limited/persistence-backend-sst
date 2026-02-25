import { describe, it, expect } from "vitest";
import { WorkoutsUpdateService } from "../workoutsUpdateService";
import { WorkoutRepository } from "../../../../repositories/workoutRepository";

describe("WorkoutsUpdateService", () => {
  it("should decorate context with WorkoutRepository", async () => {
    const instance = WorkoutsUpdateService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.WorkoutRepository).toBeDefined();
    expect(instance.WorkoutRepository).toBeInstanceOf(WorkoutRepository);
  });

  it("should provide update method via decorated service", async () => {
    const instance = WorkoutsUpdateService.singleton({} as any, {});

    expect(instance.WorkoutRepository.update).toBeDefined();
    expect(typeof instance.WorkoutRepository.update).toBe("function");
  });

  it("should have all necessary WorkoutRepository methods", async () => {
    const instance = WorkoutsUpdateService.singleton({} as any, {});

    const repo = instance.WorkoutRepository;
    expect(repo.update).toBeDefined();
  });
});
