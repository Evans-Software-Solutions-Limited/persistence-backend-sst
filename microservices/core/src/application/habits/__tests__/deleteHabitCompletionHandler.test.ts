/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const habitMock = { create: vi.fn(), list: vi.fn(), remove: vi.fn() };
const streakMock = vi.hoisted(() => ({
  rollbackHabitAdvance: vi.fn(async () => null),
}));

vi.mock("../../repositories/habitRepository", () => ({
  HabitRepository: vi.fn().mockImplementation(() => habitMock),
}));
vi.mock("../../repositories/streakRepository", () => ({
  StreakRepository: vi.fn().mockImplementation(() => streakMock),
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

describe("deleteHabitCompletionHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a completion, rolls back the streak advance, reports the result", async () => {
    habitMock.remove.mockResolvedValue("2026-06-07");
    const { deleteHabitCompletionHandler } =
      await import("../deleteHabitCompletionHandler");
    const res = await deleteHabitCompletionHandler.handle(
      new Request(
        "http://localhost/habit-completions?goalId=g1&date=2026-06-07T12:00:00Z",
        { method: "DELETE", headers: { authorization: "Bearer token" } },
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);
    expect(habitMock.remove).toHaveBeenCalledWith(
      "u1",
      "g1",
      new Date("2026-06-07T12:00:00Z"),
      undefined,
    );
    // Conditional streak rollback fires with the deleted local day.
    expect(streakMock.rollbackHabitAdvance).toHaveBeenCalledWith(
      "u1",
      "g1",
      "2026-06-07",
    );
  });

  it("passes a date-only day through as the authoritative localDate", async () => {
    habitMock.remove.mockResolvedValue("2026-06-05");
    const { deleteHabitCompletionHandler } =
      await import("../deleteHabitCompletionHandler");
    const res = await deleteHabitCompletionHandler.handle(
      new Request(
        "http://localhost/habit-completions?goalId=g1&date=2026-06-05",
        {
          method: "DELETE",
          headers: { authorization: "Bearer token" },
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(habitMock.remove.mock.calls[0][3]).toBe("2026-06-05");
  });

  it("skips the rollback when nothing was deleted", async () => {
    habitMock.remove.mockResolvedValue(null);
    const { deleteHabitCompletionHandler } =
      await import("../deleteHabitCompletionHandler");
    const res = await deleteHabitCompletionHandler.handle(
      new Request("http://localhost/habit-completions?goalId=g1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(false);
    expect(streakMock.rollbackHabitAdvance).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { deleteHabitCompletionHandler } =
      await import("../deleteHabitCompletionHandler");
    const res = await deleteHabitCompletionHandler.handle(
      new Request("http://localhost/habit-completions?goalId=g1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed date with 400 (not a 500)", async () => {
    const { deleteHabitCompletionHandler } =
      await import("../deleteHabitCompletionHandler");
    const res = await deleteHabitCompletionHandler.handle(
      new Request("http://localhost/habit-completions?goalId=g1&date=foo", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(400);
    expect(habitMock.remove).not.toHaveBeenCalled();
  });
});
