/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSummary = vi.fn();
const EXERCISE_ID = "11111111-1111-4111-8111-111111111111";
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
      new Request(
        `http://localhost/exercises/${EXERCISE_ID}/performance-summary`,
      ),
    );
    expect(res.status).toBe(401);
  });

  it("scopes by JWT user and returns data:null when history is absent", async () => {
    getSummary.mockResolvedValue(null);
    const { exercisesPerformanceSummaryHandler } =
      await import("../exercisesPerformanceSummaryHandler");
    const res = await exercisesPerformanceSummaryHandler.handle(
      new Request(
        `http://localhost/exercises/${EXERCISE_ID}/performance-summary`,
        {
          headers: { authorization: "Bearer token" },
        },
      ),
    );
    expect(getSummary).toHaveBeenCalledWith("user-a", EXERCISE_ID);
    expect(await res.json()).toEqual({ data: null });
  });

  it("rejects a malformed exercise id before querying PostgreSQL", async () => {
    const { exercisesPerformanceSummaryHandler } =
      await import("../exercisesPerformanceSummaryHandler");
    const res = await exercisesPerformanceSummaryHandler.handle(
      new Request("http://localhost/exercises/not-a-uuid/performance-summary", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(422);
    expect(getSummary).not.toHaveBeenCalled();
  });
});
