/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so the mock factory (hoisted above imports) can reference it —
// this test statically imports the handler, which eagerly loads habitService.
const habitMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));

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

import { parseWindowDays } from "../listHabitCompletionsHandler";

describe("parseWindowDays", () => {
  it("parses an Nd string", () => {
    expect(parseWindowDays("7d")).toBe(7);
    expect(parseWindowDays("30d")).toBe(30);
  });
  it("defaults to 7 for missing/invalid input", () => {
    expect(parseWindowDays(undefined)).toBe(7);
    expect(parseWindowDays("week")).toBe(7);
    expect(parseWindowDays("0d")).toBe(7);
  });
  it("caps at 366 days", () => {
    expect(parseWindowDays("500d")).toBe(366);
  });
});

describe("listHabitCompletionsHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns completions for the parsed window + goal filter", async () => {
    habitMock.list.mockResolvedValue([{ id: "h1" }]);
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request("http://localhost/habit-completions?goalId=g1&window=30d", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(1);
    expect(habitMock.list).toHaveBeenCalledWith("u1", {
      goalId: "g1",
      windowDays: 30,
    });
  });

  it("requires authentication", async () => {
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request("http://localhost/habit-completions"),
    );
    expect(res.status).toBe(401);
  });
});
