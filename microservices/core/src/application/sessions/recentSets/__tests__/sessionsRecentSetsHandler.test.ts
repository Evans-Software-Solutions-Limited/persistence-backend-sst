/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getRecentSets: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SessionsRecentSetsHandler", () => {
  const recordedAt = new Date("2026-08-07T14:25:28.838Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRecentSets.mockResolvedValue([
      {
        exerciseId: "ex-1",
        setNumber: 1,
        weightKg: "60.00",
        reps: 8,
        recordedAt,
      },
      {
        exerciseId: "ex-1",
        setNumber: 2,
        weightKg: "62.50",
        reps: 6,
        recordedAt,
      },
    ]);
  });

  it("requires authentication", async () => {
    const { sessionsRecentSetsHandler } =
      await import("../sessionsRecentSetsHandler");
    const response = await sessionsRecentSetsHandler.handle(
      new Request("http://localhost/sessions/recent-sets", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  it("scopes the read to the JWT user id", async () => {
    const { sessionsRecentSetsHandler } =
      await import("../sessionsRecentSetsHandler");
    await sessionsRecentSetsHandler.handle(
      new Request("http://localhost/sessions/recent-sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.getRecentSets).toHaveBeenCalledWith("test-user-id");
  });

  it("maps rows to the RecentSetEntry shape (numeric weight, ISO recordedAt)", async () => {
    const { sessionsRecentSetsHandler } =
      await import("../sessionsRecentSetsHandler");
    const response = await sessionsRecentSetsHandler.handle(
      new Request("http://localhost/sessions/recent-sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data).toEqual([
      {
        exerciseId: "ex-1",
        setNumber: 1,
        weightKg: 60,
        reps: 8,
        recordedAt: "2026-08-07T14:25:28.838Z",
      },
      {
        exerciseId: "ex-1",
        setNumber: 2,
        weightKg: 62.5,
        reps: 6,
        recordedAt: "2026-08-07T14:25:28.838Z",
      },
    ]);
  });

  it("drops rows with a null recordedAt (no timestamp to carry)", async () => {
    mocks.getRecentSets.mockResolvedValueOnce([
      {
        exerciseId: "ex-9",
        setNumber: 1,
        weightKg: "40.00",
        reps: 10,
        recordedAt: null,
      },
    ]);
    const { sessionsRecentSetsHandler } =
      await import("../sessionsRecentSetsHandler");
    const response = await sessionsRecentSetsHandler.handle(
      new Request("http://localhost/sessions/recent-sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data).toEqual([]);
  });

  it("returns an empty list when the user has no history", async () => {
    mocks.getRecentSets.mockResolvedValueOnce([]);
    const { sessionsRecentSetsHandler } =
      await import("../sessionsRecentSetsHandler");
    const response = await sessionsRecentSetsHandler.handle(
      new Request("http://localhost/sessions/recent-sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data).toEqual([]);
  });
});
