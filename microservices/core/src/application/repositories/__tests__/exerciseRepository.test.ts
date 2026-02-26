/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExerciseRepository } from "../exerciseRepository";

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

function makeListMock(result: any[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(result),
            }),
          }),
        }),
      }),
    }),
  };
}

describe("ExerciseRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list public exercises", async () => {
    (getDb as any).mockReturnValue(makeListMock(mockExercises));

    const repo = new ExerciseRepository();
    const result = await repo.list({
      category: "strength",
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual(mockExercises);
  });

  it("should pass difficulty filter to query", async () => {
    (getDb as any).mockReturnValue(makeListMock([mockExercises[0]]));

    const repo = new ExerciseRepository();
    const result = await repo.list({
      difficulty: "intermediate",
    });

    expect(result).toEqual([mockExercises[0]]);
  });

  it("should pass muscleGroup filter to query", async () => {
    const mockDb = makeListMock([mockExercises[0]]);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.list({
      muscleGroup: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });

    expect(result).toEqual([mockExercises[0]]);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("should escape LIKE wildcards in search", async () => {
    const mockDb = makeListMock([]);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    // These should not throw or cause unexpected results; the repo
    // escapes them so Postgres treats them as literal characters
    await expect(repo.list({ search: "100%" })).resolves.toEqual([]);
    await expect(repo.list({ search: "leg_press" })).resolves.toEqual([]);
    await expect(repo.list({ search: "a\\b" })).resolves.toEqual([]);
  });

  it("should get exercise by id", async () => {
    const mockExercise = mockExercises[0];
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
