/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const configRepoMock = {
  listForUser: vi.fn(async () => []),
  isHabitCoachLocked: vi.fn(async () => false),
};
const habitRepoMock = { list: vi.fn(async () => []) };
const configureMock = vi.fn();
const disableMock = vi.fn();
const assertMock = vi.fn();

vi.mock("../../../repositories/habitConfigRepository", () => ({
  HabitConfigRepository: vi.fn(() => configRepoMock),
}));
vi.mock("../../../repositories/habitRepository", () => ({
  HabitRepository: vi.fn(() => habitRepoMock),
}));
vi.mock("../configureClientHabit", () => ({
  configureClientHabitOnBehalf: (...a: unknown[]) => configureMock(...a),
}));
vi.mock("../disableClientHabit", () => ({
  disableClientHabitOnBehalf: (...a: unknown[]) => disableMock(...a),
}));
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: (...a: unknown[]) => assertMock(...a),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? {
          sub: "trainer-1",
          email: "t@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user ?? { sub: "trainer-1" }),
}));

function req(path: string, method: string, body?: unknown, auth = true) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  configRepoMock.listForUser.mockResolvedValue([]);
  configRepoMock.isHabitCoachLocked.mockResolvedValue(false);
  habitRepoMock.list.mockResolvedValue([]);
  assertMock.mockResolvedValue({ allowed: true });
});

describe("GET /trainers/me/clients/:clientId/habits/config", () => {
  it("401 without auth", async () => {
    const { trainersMeGetClientHabitConfigHandler } =
      await import("../trainersMeGetClientHabitConfigHandler");
    const res = await trainersMeGetClientHabitConfigHandler.handle(
      req("/trainers/me/clients/c1/habits/config", "GET", undefined, false),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the gate denies", async () => {
    assertMock.mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "not_your_client", message: "no" },
    });
    const { trainersMeGetClientHabitConfigHandler } =
      await import("../trainersMeGetClientHabitConfigHandler");
    const res = await trainersMeGetClientHabitConfigHandler.handle(
      req("/trainers/me/clients/c1/habits/config", "GET"),
    );
    expect(res.status).toBe(403);
  });

  it("returns five categories with lock state for the client", async () => {
    configRepoMock.listForUser.mockResolvedValue([
      {
        category: "water",
        goalId: "g1",
        enabled: true,
        assignedByUserId: "trainer-1",
        targetValue: 3,
        unit: "l",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 5,
        tolerancePct: null,
        pending: null,
      },
    ] as any);
    configRepoMock.isHabitCoachLocked.mockResolvedValue(true);
    const { trainersMeGetClientHabitConfigHandler } =
      await import("../trainersMeGetClientHabitConfigHandler");
    const res = await trainersMeGetClientHabitConfigHandler.handle(
      req("/trainers/me/clients/c1/habits/config", "GET"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data.map((d) => d.category)).toEqual([
      "water",
      "gym",
      "steps",
      "sleep",
      "calories",
    ]);
    const water = body.data.find((d) => d.category === "water");
    expect(water.locked).toBe(true);
    expect(water.assignedByCoach).toBe(true);
  });
});

describe("PUT /trainers/me/clients/:clientId/habits/:category/config", () => {
  it("delegates and returns the view", async () => {
    configureMock.mockResolvedValue({
      ok: true,
      view: { goalId: "g1", category: "water" },
    });
    const { trainersMeSetClientHabitConfigHandler } =
      await import("../trainersMeSetClientHabitConfigHandler");
    const res = await trainersMeSetClientHabitConfigHandler.handle(
      req("/trainers/me/clients/c1/habits/water/config", "PUT", {
        targetValue: 2.5,
        daysPerWeek: 5,
      }),
    );
    expect(res.status).toBe(200);
    expect(configureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "c1",
        category: "water",
      }),
    );
  });

  it("surfaces the core's status on failure", async () => {
    configureMock.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_habit" },
    });
    const { trainersMeSetClientHabitConfigHandler } =
      await import("../trainersMeSetClientHabitConfigHandler");
    const res = await trainersMeSetClientHabitConfigHandler.handle(
      req("/trainers/me/clients/c1/habits/water/config", "PUT", {
        targetValue: 2.5,
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /trainers/me/clients/:clientId/habits/:category", () => {
  it("delegates and confirms disable", async () => {
    disableMock.mockResolvedValue({ ok: true, goalId: "g1" });
    const { trainersMeDeleteClientHabitHandler } =
      await import("../trainersMeDeleteClientHabitHandler");
    const res = await trainersMeDeleteClientHabitHandler.handle(
      req("/trainers/me/clients/c1/habits/water", "DELETE"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { disabled: boolean } };
    expect(body.data.disabled).toBe(true);
  });

  it("surfaces a 403 from the core", async () => {
    disableMock.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_habit" },
    });
    const { trainersMeDeleteClientHabitHandler } =
      await import("../trainersMeDeleteClientHabitHandler");
    const res = await trainersMeDeleteClientHabitHandler.handle(
      req("/trainers/me/clients/c1/habits/water", "DELETE"),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /trainers/me/clients/:clientId/habit-completions", () => {
  it("403 when the gate denies", async () => {
    assertMock.mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "not_your_client" },
    });
    const { trainersMeListClientHabitCompletionsHandler } =
      await import("../trainersMeListClientHabitCompletionsHandler");
    const res = await trainersMeListClientHabitCompletionsHandler.handle(
      req("/trainers/me/clients/c1/habit-completions", "GET"),
    );
    expect(res.status).toBe(403);
    expect(habitRepoMock.list).not.toHaveBeenCalled();
  });

  it("reads the client's completions from the DB", async () => {
    habitRepoMock.list.mockResolvedValue([{ id: "hc1" }] as any);
    const { trainersMeListClientHabitCompletionsHandler } =
      await import("../trainersMeListClientHabitCompletionsHandler");
    const res = await trainersMeListClientHabitCompletionsHandler.handle(
      req("/trainers/me/clients/c1/habit-completions?window=14d", "GET"),
    );
    expect(res.status).toBe(200);
    expect(habitRepoMock.list).toHaveBeenCalledWith("c1", {
      goalId: undefined,
      windowDays: 14,
    });
  });
});
