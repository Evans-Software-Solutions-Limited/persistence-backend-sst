import { describe, it, expect, vi, beforeEach } from "vitest";
import { categoriesHandler } from "../categoriesHandler";

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    getCategories: vi
      .fn()
      .mockResolvedValue(["strength", "cardio", "flexibility", "balance"]),
  })),
}));

describe("CategoriesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with categories data", async () => {
    const response = await categoriesHandler.handle(
      new Request("http://localhost/exercises/categories", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: string[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("should return string array of categories", async () => {
    const response = await categoriesHandler.handle(
      new Request("http://localhost/exercises/categories", {
        method: "GET",
      }),
    );

    const body = (await response.json()) as { data: string[] };
    expect(body.data.every((cat: unknown) => typeof cat === "string")).toBe(
      true,
    );
  });
});
