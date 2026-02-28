import { describe, it, expect, vi, beforeEach } from "vitest";
import { muscleGroupsHandler } from "../muscleGroupsHandler";

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    getMuscleGroups: vi.fn().mockResolvedValue([
      {
        id: "mg-1",
        name: "Chest",
        description: "Chest muscles",
        displayName: "Chest",
      },
      {
        id: "mg-2",
        name: "Back",
        description: "Back muscles",
        displayName: "Back",
      },
    ]),
  })),
}));

describe("MuscleGroupsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with muscle groups data", async () => {
    const response = await muscleGroupsHandler.handle(
      new Request("http://localhost/exercises/muscle-groups", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("should return muscle group objects with required fields", async () => {
    const response = await muscleGroupsHandler.handle(
      new Request("http://localhost/exercises/muscle-groups", {
        method: "GET",
      }),
    );

    const body = (await response.json()) as {
      data: { id: string; name: string }[];
    };
    expect(body.data[0]).toHaveProperty("id");
    expect(body.data[0]).toHaveProperty("name");
  });
});
