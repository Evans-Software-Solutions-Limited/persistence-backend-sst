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
      { id: "eq-1", name: "Dumbbell" },
    ]);
    const { equipmentHandler } = await import("../equipmentHandler");
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("projects only { id, name, display_name: null, category } (AC 7.9 + spec-21 AC-2.2)", async () => {
    // Repo returns Supabase-aligned EquipmentTypeRow ({ id, name, category })
    // — no description column in the live DB.
    exerciseRepositoryMocks.getEquipmentTypes.mockResolvedValue([
      { id: "eq-1", name: "Barbell", category: "free_weights" },
      { id: "eq-2", name: "Dumbbell", category: "free_weights" },
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
      display_name: null,
      category: "free_weights",
    });
    expect(body.data[1].display_name).toBeNull();
    // description was dropped alongside the repo projection change —
    // it isn't in Supabase, mustn't appear in the response.
    expect(body.data[0]).not.toHaveProperty("description");
  });

  // spec-21 § 2.3b: an uncategorised row renders under "Other" in the Loadout
  // picker rather than disappearing from it — which needs the key PRESENT and
  // null on the wire, not absent. `undefined` would be dropped by JSON.
  it("emits category: null (not a missing key) for an uncategorised row", async () => {
    exerciseRepositoryMocks.getEquipmentTypes.mockResolvedValue([
      { id: "eq-1", name: "Novel Contraption", category: null },
      // Defensive: a row read by an older projection that omits the field.
      { id: "eq-2", name: "Older Row" },
    ]);

    const { equipmentHandler } = await import("../equipmentHandler");
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment"),
    );

    const body = (await response.json()) as { data: any[] };
    expect(body.data[0]).toHaveProperty("category", null);
    expect(body.data[1]).toHaveProperty("category", null);
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
