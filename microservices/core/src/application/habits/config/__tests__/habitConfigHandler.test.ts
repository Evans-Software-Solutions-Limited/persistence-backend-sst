/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMock = {
  listForUser: vi.fn(async () => []),
  isHabitCoachLocked: vi.fn(async () => false),
  upsert: vi.fn(),
  disable: vi.fn(async () => true),
};

vi.mock("../../../repositories/habitConfigRepository", () => ({
  HabitConfigRepository: vi.fn().mockImplementation(() => repoMock),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) =>
    authHeader?.startsWith("Bearer ")
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

function req(
  path: string,
  method: string,
  body?: unknown,
  auth = true,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const load = () => import("../habitConfigHandler");

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.listForUser.mockResolvedValue([]);
  repoMock.isHabitCoachLocked.mockResolvedValue(false);
  repoMock.disable.mockResolvedValue(true);
});

describe("GET /users/me/habits/config", () => {
  it("requires auth", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/config", "GET", undefined, false),
    );
    expect(res.status).toBe(401);
  });

  it("returns all five categories, defaulting the unconfigured ones", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/config", "GET"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { category: string; enabled: boolean }[];
    };
    expect(body.data.map((d) => d.category)).toEqual([
      "water",
      "gym",
      "steps",
      "sleep",
      "calories",
    ]);
    expect(body.data.every((d) => d.enabled === false)).toBe(true);
  });

  it("merges a configured habit and computes coach-lock for assigned ones", async () => {
    repoMock.listForUser.mockResolvedValue([
      {
        category: "water",
        goalId: "g1",
        enabled: true,
        assignedByUserId: "coach1",
        assignedByName: "Coach One",
        targetValue: 3,
        unit: "l",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 6,
        tolerancePct: null,
        pending: null,
      },
    ] as any);
    repoMock.isHabitCoachLocked.mockResolvedValue(true);

    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/config", "GET"),
    );
    const body = (await res.json()) as { data: any[] };
    const water = body.data.find((d) => d.category === "water");
    expect(water.enabled).toBe(true);
    expect(water.assignedByCoach).toBe(true);
    expect(water.assignedByName).toBe("Coach One");
    expect(water.locked).toBe(true);
    expect(water.targetValue).toBe(3);
    // Coach-lock is only probed for assigned habits.
    expect(repoMock.isHabitCoachLocked).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /users/me/habits/:category/config", () => {
  it("404s an unknown category", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/mood/config", "PUT", { targetValue: 1 }),
    );
    expect(res.status).toBe(404);
    expect(repoMock.upsert).not.toHaveBeenCalled();
  });

  it("403s a coach-locked habit", async () => {
    repoMock.isHabitCoachLocked.mockResolvedValue(true);
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water/config", "PUT", { targetValue: 2 }),
    );
    expect(res.status).toBe(403);
    expect(repoMock.upsert).not.toHaveBeenCalled();
  });

  it("422s an out-of-bounds target", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water/config", "PUT", { targetValue: 999 }),
    );
    expect(res.status).toBe(422);
    expect(repoMock.upsert).not.toHaveBeenCalled();
  });

  it("enables a valid habit and returns the view", async () => {
    repoMock.upsert.mockResolvedValue({
      category: "water",
      goalId: "g1",
      enabled: true,
      pending: null,
    });
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water/config", "PUT", {
        targetValue: 2.5,
        daysPerWeek: 6,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { enabled: boolean } };
    expect(body.data.enabled).toBe(true);
    expect(repoMock.upsert).toHaveBeenCalledWith(
      "u1",
      "water",
      expect.objectContaining({
        category: "water",
        targetValue: 2.5,
        daysPerWeek: 6,
        completionRule: "value_gte",
      }),
    );
  });

  it("404s when upsert reports an unseeded category", async () => {
    repoMock.upsert.mockResolvedValue(null);
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water/config", "PUT", { targetValue: 2 }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /users/me/habits/:category", () => {
  it("404s an unknown category", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/mood", "DELETE"),
    );
    expect(res.status).toBe(404);
    expect(repoMock.disable).not.toHaveBeenCalled();
  });

  it("403s a coach-locked habit", async () => {
    repoMock.isHabitCoachLocked.mockResolvedValue(true);
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water", "DELETE"),
    );
    expect(res.status).toBe(403);
    expect(repoMock.disable).not.toHaveBeenCalled();
  });

  it("disables an enabled habit", async () => {
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water", "DELETE"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { disabled: boolean } };
    expect(body.data.disabled).toBe(true);
    expect(repoMock.disable).toHaveBeenCalledWith("u1", "water");
  });

  it("404s when the habit is not enabled", async () => {
    repoMock.disable.mockResolvedValue(false);
    const { habitConfigHandler } = await load();
    const res = await habitConfigHandler.handle(
      req("/users/me/habits/water", "DELETE"),
    );
    expect(res.status).toBe(404);
  });
});
