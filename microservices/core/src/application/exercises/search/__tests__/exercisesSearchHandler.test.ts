import { describe, it, expect, vi, beforeEach } from "vitest";

const exerciseRepositoryMocks = {
  search: vi.fn().mockResolvedValue({
    rows: [{ id: "1", name: "Bench Press" }],
    total: 1,
  }),
  list: vi.fn(),
  count: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getMuscleGroups: vi.fn(),
  getEquipmentTypes: vi.fn(),
  getCategories: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-1",
      email: "u@e.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn(),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/exerciseRepository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../repositories/exerciseRepository")
    >();
  return {
    ...actual,
    ExerciseRepository: vi
      .fn()
      .mockImplementation(() => exerciseRepositoryMocks),
  };
});

describe("ExercisesSearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exerciseRepositoryMocks.search.mockResolvedValue({
      rows: [{ id: "1", name: "Bench Press" }],
      total: 1,
    });
  });

  it("returns 200 with double-envelope payload on a valid query", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    const response = await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=bench"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        data: unknown[];
        meta: { total: number; offset: number; limit: number };
      };
    };
    expect(Array.isArray(body.data.data)).toBe(true);
    expect(body.data.meta).toEqual({ total: 1, offset: 0, limit: 20 });
  });

  it("rejects q shorter than MIN_SEARCH_LENGTH (2) with 400", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    const response = await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=a"),
    );
    expect(response.status).toBe(400);
    expect(exerciseRepositoryMocks.search).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only q (length 0 after trim) with 400", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    const response = await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=%20%20%20"),
    );
    expect(response.status).toBe(400);
    expect(exerciseRepositoryMocks.search).not.toHaveBeenCalled();
  });

  it("forwards limit/offset from query string", async () => {
    exerciseRepositoryMocks.search.mockResolvedValue({ rows: [], total: 42 });
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    const response = await exercisesSearchHandler.handle(
      new Request(
        "http://localhost/exercises/search?q=bench&limit=5&offset=10",
      ),
    );
    const body = (await response.json()) as {
      data: { meta: { total: number; offset: number; limit: number } };
    };
    expect(body.data.meta).toEqual({ total: 42, offset: 10, limit: 5 });
    expect(exerciseRepositoryMocks.search).toHaveBeenCalledWith(
      "bench",
      null,
      5,
      10,
    );
  });

  it("clamps limit to MAX_LIMIT (100)", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=bench&limit=999999"),
    );
    const [, , clampedLimit] = exerciseRepositoryMocks.search.mock.calls[0];
    expect(clampedLimit).toBe(100);
  });

  it("floors a negative offset to 0", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=bench&offset=-50"),
    );
    const [, , , offset] = exerciseRepositoryMocks.search.mock.calls[0];
    expect(offset).toBe(0);
  });

  it("passes userId=null when unauthenticated", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=bench"),
    );
    const [, userId] = exerciseRepositoryMocks.search.mock.calls[0];
    expect(userId).toBeNull();
  });

  it("passes userId from JWT when authenticated", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=bench", {
        headers: { authorization: "Bearer fake" },
      }),
    );
    const [, userId] = exerciseRepositoryMocks.search.mock.calls[0];
    expect(userId).toBe("user-1");
  });

  it("trims surrounding whitespace from q before length check + repo call", async () => {
    const { exercisesSearchHandler } =
      await import("../exercisesSearchHandler");
    await exercisesSearchHandler.handle(
      new Request("http://localhost/exercises/search?q=%20%20bench%20%20"),
    );
    const [qPassed] = exerciseRepositoryMocks.search.mock.calls[0];
    expect(qPassed).toBe("bench");
  });
});
