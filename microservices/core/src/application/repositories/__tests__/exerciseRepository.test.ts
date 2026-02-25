/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExerciseRepository } from "../exerciseRepository";

// Mock the database client
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

const mockExercises = [
  {
    id: "ex-1",
    name: "Squat",
    category: "strength",
    difficultyLevel: "intermediate",
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ex-2",
    name: "Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("ExerciseRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list public exercises", async () => {
    const mockDb: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockExercises),
              }),
            }),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.list({
      category: "strength",
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual(mockExercises);
  });

  it("should get exercise by id", async () => {
    const mockExercise = {
      id: "ex-1",
      name: "Squat",
      category: "strength",
      difficultyLevel: "intermediate",
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockExercise]),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.getById("ex-1");

    expect(result).toEqual(mockExercise);
  });

  it("should return null when exercise not found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.getById("nonexistent");

    expect(result).toBeNull();
  });
});
