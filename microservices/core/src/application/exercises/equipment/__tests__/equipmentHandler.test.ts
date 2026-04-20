/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const exerciseRepositoryMocks = {
  getEquipmentTypes: vi.fn(),
  getMuscleGroups: vi.fn(),
  getCategories: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepositoryMocks),
}));

describe("EquipmentHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with { data } array", async () => {
    exerciseRepositoryMocks.getEquipmentTypes.mockResolvedValue([
      { id: "eq-1", name: "Dumbbell", description: "Hand weights" },
    ]);
    const { equipmentHandler } = await import("../equipmentHandler");
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("projects display_name: null alongside id/name/description (AC 7.9)", async () => {
    exerciseRepositoryMocks.getEquipmentTypes.mockResolvedValue([
      {
        id: "eq-1",
        name: "Barbell",
        description: "Long bar with weights",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "eq-2",
        name: "Dumbbell",
        description: "Hand weights",
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const { equipmentHandler } = await import("../equipmentHandler");
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: any[] };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toEqual({
      id: "eq-1",
      name: "Barbell",
      description: "Long bar with weights",
      display_name: null,
    });
    expect(body.data[1].display_name).toBeNull();
    // createdAt must be stripped from the projection
    expect(body.data[0]).not.toHaveProperty("createdAt");
  });

  it("returns empty array cleanly when no equipment rows", async () => {
    exerciseRepositoryMocks.getEquipmentTypes.mockResolvedValue([]);
    const { equipmentHandler } = await import("../equipmentHandler");
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment"),
    );
    const body = (await response.json()) as { data: any[] };
    expect(body.data).toEqual([]);
  });
});
