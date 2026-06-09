/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const habitMock = { create: vi.fn(), list: vi.fn(), remove: vi.fn() };

vi.mock("../../repositories/habitRepository", () => ({
  HabitRepository: vi.fn().mockImplementation(() => habitMock),
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

  it("deletes a completion and reports the result", async () => {
    habitMock.remove.mockResolvedValue(true);
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
    );
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
});
