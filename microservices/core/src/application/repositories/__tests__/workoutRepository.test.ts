/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkoutRepository } from "../workoutRepository";

// Mock the database client
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

describe("WorkoutRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list user workouts", async () => {
    const mockWorkouts = [
      {
        id: "wo-1",
        name: "Full Body",
        createdBy: "user-1",
        visibility: "private",
        estimatedDurationMinutes: 45,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockWorkouts),
              }),
            }),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.list("user-1", { type: "mine" });

    expect(result).toEqual(mockWorkouts);
  });

  it("should get workout by id with exercises", async () => {
    const mockWorkout = {
      id: "wo-1",
      name: "Full Body",
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 45,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockExercises = [
      {
        id: "we-1",
        exerciseId: "ex-1",
        sortOrder: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetDurationSeconds: null,
        restSeconds: 90,
        notes: null,
        exercise: {
          id: "ex-1",
          name: "Squat",
          category: "strength",
          difficultyLevel: "intermediate",
          videoUrl: null,
          thumbnailUrl: null,
        },
      },
    ];

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockWorkout]),
          }),
        }),
      }),
    };

    // Mock the exercises query
    mockDb.select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockWorkout]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(mockExercises),
            }),
          }),
        }),
      });

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.getById("wo-1", "user-1");

    expect(result).not.toBeNull();
    expect(result?.exercises).toEqual(mockExercises);
  });

  it("should return null when unauthorized", async () => {
    const mockWorkout = {
      id: "wo-1",
      name: "Full Body",
      createdBy: "other-user",
      visibility: "private",
      estimatedDurationMinutes: 45,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockWorkout]),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.getById("wo-1", "user-1");

    expect(result).toBeNull();
  });

  it("should create a workout", async () => {
    const mockCreatedWorkout = {
      id: "wo-1",
      name: "New Workout",
      description: null,
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockCreatedWorkout]),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.create("user-1", {
      name: "New Workout",
      visibility: "private",
      estimatedDurationMinutes: 30,
    });

    expect(result).toEqual(mockCreatedWorkout);
  });

  it("should update a workout", async () => {
    const mockExistingWorkout = {
      id: "wo-1",
      name: "Full Body",
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 45,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockUpdatedWorkout = {
      ...mockExistingWorkout,
      name: "Updated Workout",
      estimatedDurationMinutes: 60,
    };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockExistingWorkout]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdatedWorkout]),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.update("wo-1", "user-1", {
      name: "Updated Workout",
      estimatedDurationMinutes: 60,
    });

    expect(result).toEqual(mockUpdatedWorkout);
  });

  it("should delete a workout", async () => {
    const mockExistingWorkout = {
      id: "wo-1",
      name: "Full Body",
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 45,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockExistingWorkout]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockExistingWorkout]),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new WorkoutRepository();
    const result = await repo.delete("wo-1", "user-1");

    expect(result).toBe(true);
  });
});
