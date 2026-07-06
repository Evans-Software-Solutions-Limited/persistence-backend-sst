/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMock = {
  listForUser: vi.fn(async () => []),
  declare: vi.fn(),
  endEarly: vi.fn(),
};

vi.mock("../../../repositories/habitHolidayRepository", () => ({
  HabitHolidayRepository: vi.fn().mockImplementation(() => repoMock),
}));
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

const load = () => import("../habitHolidayHandler");

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.listForUser.mockResolvedValue([]);
});

describe("GET /users/me/habits/holidays", () => {
  it("requires auth", async () => {
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays", "GET", undefined, false),
    );
    expect(res.status).toBe(401);
  });

  it("returns the user's holidays", async () => {
    repoMock.listForUser.mockResolvedValue([{ id: "h1" }] as any);
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays", "GET"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([{ id: "h1" }]);
  });
});

describe("POST /users/me/habits/holidays", () => {
  it("rejects a non-date payload with 422", async () => {
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays", "POST", {
        startDate: "next week",
        endDate: "2026-06-14",
      }),
    );
    expect(res.status).toBe(422);
    expect(repoMock.declare).not.toHaveBeenCalled();
  });

  it("surfaces the repo's 422 (too-soon / inverted)", async () => {
    repoMock.declare.mockResolvedValue({
      ok: false,
      status: 422,
      error: "A holiday must start at least 24 hours in advance",
    });
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays", "POST", {
        startDate: "2026-06-10",
        endDate: "2026-06-12",
      }),
    );
    expect(res.status).toBe(422);
  });

  it("creates a valid holiday (201)", async () => {
    repoMock.declare.mockResolvedValue({ ok: true, holiday: { id: "h1" } });
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays", "POST", {
        startDate: "2026-06-12",
        endDate: "2026-06-14",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe("h1");
    expect(repoMock.declare).toHaveBeenCalledWith(
      "u1",
      "2026-06-12",
      "2026-06-14",
    );
  });
});

describe("DELETE /users/me/habits/holidays/:id", () => {
  it("409s on a past holiday", async () => {
    repoMock.endEarly.mockResolvedValue({
      ok: false,
      status: 409,
      error: "A past holiday cannot be changed",
    });
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays/h1", "DELETE"),
    );
    expect(res.status).toBe(409);
  });

  it("returns the truncate/cancel action", async () => {
    repoMock.endEarly.mockResolvedValue({
      ok: true,
      action: "truncated",
      holiday: { id: "h1", endDate: "2026-06-10" },
    });
    const { habitHolidayHandler } = await load();
    const res = await habitHolidayHandler.handle(
      req("/users/me/habits/holidays/h1", "DELETE"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { action: string } };
    expect(body.data.action).toBe("truncated");
  });
});
