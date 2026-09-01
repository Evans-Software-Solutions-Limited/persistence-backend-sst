/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSummary = vi.fn();
vi.mock("../../../repositories/exercisePerformanceRepository", () => ({
  ExercisePerformanceRepository: vi.fn(() => ({ getSummary })),
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

describe("exercisesPerformanceSummaryHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { exercisesPerformanceSummaryHandler } =
      await import("../exercisesPerformanceSummaryHandler");
    const res = await exercisesPerformanceSummaryHandler.handle(
      new Request("http://localhost/exercises/ex-1/performance-summary"),
    );
    expect(res.status).toBe(401);
  });

  it("scopes by JWT user and returns data:null when history is absent", async () => {
    getSummary.mockResolvedValue(null);
    const { exercisesPerformanceSummaryHandler } =
      await import("../exercisesPerformanceSummaryHandler");
    const res = await exercisesPerformanceSummaryHandler.handle(
      new Request("http://localhost/exercises/ex-1/performance-summary", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(getSummary).toHaveBeenCalledWith("user-a", "ex-1");
    expect(await res.json()).toEqual({ data: null });
  });
});
