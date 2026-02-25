import { describe, it, expect } from "vitest";
import { WorkoutsGetService } from "../workoutsGetService";
import { WorkoutRepository } from "../../../../repositories/workoutRepository";

describe("WorkoutsGetService", () => {
  it("should decorate context with WorkoutRepository", async () => {
    const instance = WorkoutsGetService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.WorkoutRepository).toBeDefined();
    expect(instance.WorkoutRepository).toBeInstanceOf(WorkoutRepository);
  });

  it("should provide getById method via decorated service", async () => {
    const instance = WorkoutsGetService.singleton({} as any, {});

    expect(instance.WorkoutRepository.getById).toBeDefined();
    expect(typeof instance.WorkoutRepository.getById).toBe("function");
  });

  it("should decorate with all necessary WorkoutRepository methods", async () => {
    const instance = WorkoutsGetService.singleton({} as any, {});

    const repo = instance.WorkoutRepository;
    expect(repo.getById).toBeDefined();
  });
});
