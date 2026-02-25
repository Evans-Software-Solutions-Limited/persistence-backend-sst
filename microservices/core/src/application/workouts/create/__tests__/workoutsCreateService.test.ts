import { describe, it, expect } from "vitest";
import { WorkoutsCreateService } from "../workoutsCreateService";
import { WorkoutRepository } from "../../../../repositories/workoutRepository";

describe("WorkoutsCreateService", () => {
  it("should decorate context with WorkoutRepository", async () => {
    const instance = WorkoutsCreateService.singleton({} as any, {});

    expect(instance).toBeDefined();
    expect(instance.WorkoutRepository).toBeDefined();
    expect(instance.WorkoutRepository).toBeInstanceOf(WorkoutRepository);
  });

  it("should make create method available via decorated service", async () => {
    const instance = WorkoutsCreateService.singleton({} as any, {});

    expect(instance.WorkoutRepository.create).toBeDefined();
    expect(typeof instance.WorkoutRepository.create).toBe("function");
  });

  it("should have WorkoutRepository with required methods", async () => {
    const instance = WorkoutsCreateService.singleton({} as any, {});

    expect(instance.WorkoutRepository.create).toBeDefined();
  });
});
