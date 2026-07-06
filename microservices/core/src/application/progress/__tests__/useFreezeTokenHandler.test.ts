/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMock = {
  spendTokenManually: vi.fn(),
  skipCurrentPeriod: vi.fn(),
};

vi.mock("../../repositories/streakReadService", async () => {
  const Elysia = (await import("elysia")).default;
  return {
    StreakReadService: new Elysia({ name: "StreakReadService" }).decorate(
      "StreakRepository",
      repoMock,
    ),
  };
});
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? { sub: "u1", email: "t@e.com", email_verified: true, iat: 0, exp: 9e9 }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user ?? { sub: "u1" }),
}));

function req(path: string, body?: unknown, auth = true) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const load = () => import("../useFreezeTokenHandler");

beforeEach(() => vi.clearAllMocks());

describe("POST /users/me/streaks/:id/use-token", () => {
  it("requires auth", async () => {
    const { useFreezeTokenHandler } = await load();
    const res = await useFreezeTokenHandler.handle(
      req("/users/me/streaks/s1/use-token", undefined, false),
    );
    expect(res.status).toBe(401);
  });

  it("defaults to the retroactive spend", async () => {
    repoMock.spendTokenManually.mockResolvedValue({ id: "s1" });
    const { useFreezeTokenHandler } = await load();
    const res = await useFreezeTokenHandler.handle(
      req("/users/me/streaks/s1/use-token"),
    );
    expect(res.status).toBe(200);
    expect(repoMock.spendTokenManually).toHaveBeenCalledWith("u1", "s1");
    expect(repoMock.skipCurrentPeriod).not.toHaveBeenCalled();
  });

  it("routes mode:skip to the proactive skip", async () => {
    repoMock.skipCurrentPeriod.mockResolvedValue({ id: "s1" });
    const { useFreezeTokenHandler } = await load();
    const res = await useFreezeTokenHandler.handle(
      req("/users/me/streaks/s1/use-token", { mode: "skip" }),
    );
    expect(res.status).toBe(200);
    expect(repoMock.skipCurrentPeriod).toHaveBeenCalledWith("u1", "s1");
    expect(repoMock.spendTokenManually).not.toHaveBeenCalled();
  });

  it("400s when the spend can't happen", async () => {
    repoMock.spendTokenManually.mockResolvedValue(null);
    const { useFreezeTokenHandler } = await load();
    const res = await useFreezeTokenHandler.handle(
      req("/users/me/streaks/s1/use-token", { mode: "retroactive" }),
    );
    expect(res.status).toBe(400);
  });
});
