import { describe, it, expect } from "vitest";
import { WorkoutsDeleteService } from "../workoutsDeleteService";
import { WorkoutRepository } from "../../../../repositories/workoutRepository";

describe("WorkoutsDeleteService", () => {
  it("should decorate context with WorkoutRepository", async () => {
    const instance = WorkoutsDeleteService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.WorkoutRepository).toBeDefined();
    expect(instance.WorkoutRepository).toBeInstanceOf(WorkoutRepository);
  });

  it("should make delete method available via decorated service", async () => {
    const instance = WorkoutsDeleteService.singleton({} as any, {});

    expect(instance.WorkoutRepository.delete).toBeDefined();
    expect(typeof instance.WorkoutRepository.delete).toBe("function");
  });

  it("should provide WorkoutRepository methods", async () => {
    const instance = WorkoutsDeleteService.singleton({} as any, {});

    const repo = instance.WorkoutRepository;
    expect(repo.delete).toBeDefined();
  });
});
