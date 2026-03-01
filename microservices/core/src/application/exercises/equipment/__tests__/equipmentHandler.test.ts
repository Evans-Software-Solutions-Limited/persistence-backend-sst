import { describe, it, expect, vi, beforeEach } from "vitest";
import { equipmentHandler } from "../equipmentHandler";

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    getEquipmentTypes: vi.fn().mockResolvedValue([
      {
        id: "eq-1",
        name: "Dumbbell",
        description: "Hand weights",
      },
      {
        id: "eq-2",
        name: "Barbell",
        description: "Long bar with weights",
      },
    ]),
  })),
}));

describe("EquipmentHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with equipment types data", async () => {
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("should return equipment objects with required fields", async () => {
    const response = await equipmentHandler.handle(
      new Request("http://localhost/exercises/equipment", {
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
