/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBest = vi.fn();
vi.mock("../../../repositories/exercisePerformanceRepository", () => ({
  ExercisePerformanceRepository: vi.fn(() => ({
    getBestEstimatedOneRepMax: getBest,
  })),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header?: string) =>
    header ? { sub: "user-a" } : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user),
}));

describe("exercisesEstimatedOneRepMaxHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { exercisesEstimatedOneRepMaxHandler } =
      await import("../exercisesEstimatedOneRepMaxHandler");
    const res = await exercisesEstimatedOneRepMaxHandler.handle(
      new Request("http://localhost/exercises/ex-1/estimated-1rm"),
    );
    expect(res.status).toBe(401);
  });

  it("scopes by JWT user and returns data:null when history is absent", async () => {
    getBest.mockResolvedValue(null);
    const { exercisesEstimatedOneRepMaxHandler } =
      await import("../exercisesEstimatedOneRepMaxHandler");
    const res = await exercisesEstimatedOneRepMaxHandler.handle(
      new Request("http://localhost/exercises/ex-1/estimated-1rm", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(getBest).toHaveBeenCalledWith("user-a", "ex-1");
    expect(await res.json()).toEqual({ data: null });
  });
});
