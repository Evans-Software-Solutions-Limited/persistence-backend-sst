/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so the mock factory (hoisted above imports) can reference it —
// this test statically imports the handler, which eagerly loads habitService.
const habitMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));
type DerivedCompletionLike = {
  id: string;
  userId: string;
  goalId: string;
  completedAt: Date;
  localCompletedDate: string;
  value: number | null;
};
const streakMock = vi.hoisted(() => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  getDerivedHabitCompletions: vi.fn(
    async (...args: any[]): Promise<DerivedCompletionLike[]> => {
      void args;
      return [];
    },
  ),
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

  // BRIEF-7 QA-1..QA-4 (mobile half): `includeDerived` is opt-in so every
  // OTHER caller of this endpoint (and of HabitRepository.list, unchanged)
  // sees byte-identical behaviour by default.
  it("omits derived rows and never touches StreakRepository when includeDerived is absent", async () => {
    habitMock.list.mockResolvedValue([{ id: "h1", goalId: "g1" }]);
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request("http://localhost/habit-completions", {
        headers: { authorization: "Bearer token" },
      }),
    );
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([{ id: "h1", goalId: "g1" }]);
    expect(streakMock.getUserTimezone).not.toHaveBeenCalled();
    expect(streakMock.getDerivedHabitCompletions).not.toHaveBeenCalled();
  });

  it("omits derived rows when includeDerived is anything other than the literal 'true'", async () => {
    habitMock.list.mockResolvedValue([]);
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request("http://localhost/habit-completions?includeDerived=1", {
        headers: { authorization: "Bearer token" },
      }),
    );
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
    expect(streakMock.getDerivedHabitCompletions).not.toHaveBeenCalled();
  });

  it("includeDerived=true merges synthetic Gym/Calories rows computed over the parsed window + user tz", async () => {
    habitMock.list.mockResolvedValue([{ id: "h1", goalId: "g-water" }]);
    streakMock.getUserTimezone.mockResolvedValue("America/New_York");
    streakMock.getDerivedHabitCompletions.mockResolvedValue([
      {
        id: "derived-g-gym-2026-06-09",
        userId: "u1",
        goalId: "g-gym",
        completedAt: new Date("2026-06-09T12:00:00.000Z"),
        localCompletedDate: "2026-06-09",
        value: null,
      },
    ]);
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request(
        "http://localhost/habit-completions?includeDerived=true&window=14d",
        { headers: { authorization: "Bearer token" } },
      ),
    );
    const json = (await res.json()) as { data: { goalId: string }[] };
    expect(json.data).toHaveLength(2);
    expect(json.data.map((d) => d.goalId)).toEqual(
      expect.arrayContaining(["g-water", "g-gym"]),
    );
    expect(streakMock.getUserTimezone).toHaveBeenCalledWith("u1");
    // The derived window is built from the SAME parsed windowDays (14), not
    // the endpoint's default 7 — so it can never silently disagree with the
    // real-completions window the caller asked for.
    expect(streakMock.getDerivedHabitCompletions).toHaveBeenCalledWith(
      "u1",
      expect.arrayContaining([expect.any(String)]),
      "America/New_York",
    );
    const [, derivedWindow] = streakMock.getDerivedHabitCompletions.mock
      .calls[0] as [string, string[], string];
    expect(derivedWindow).toHaveLength(14);
  });

  it("includeDerived=true + goalId scopes derived rows to that goal only", async () => {
    habitMock.list.mockResolvedValue([]);
    streakMock.getDerivedHabitCompletions.mockResolvedValue([
      {
        id: "derived-g-gym-2026-06-09",
        userId: "u1",
        goalId: "g-gym",
        completedAt: new Date("2026-06-09T12:00:00.000Z"),
        localCompletedDate: "2026-06-09",
        value: null,
      },
      {
        id: "derived-g-cal-2026-06-09",
        userId: "u1",
        goalId: "g-cal",
        completedAt: new Date("2026-06-09T12:00:00.000Z"),
        localCompletedDate: "2026-06-09",
        value: null,
      },
    ]);
    const { listHabitCompletionsHandler } =
      await import("../listHabitCompletionsHandler");
    const res = await listHabitCompletionsHandler.handle(
      new Request(
        "http://localhost/habit-completions?includeDerived=true&goalId=g-gym",
        { headers: { authorization: "Bearer token" } },
      ),
    );
    const json = (await res.json()) as { data: { goalId: string }[] };
    expect(json.data).toEqual([expect.objectContaining({ goalId: "g-gym" })]);
  });
});

describe("parseIncludeDerived", () => {
  it("is true only for the literal string 'true'", async () => {
    const { parseIncludeDerived } =
      await import("../listHabitCompletionsHandler");
    expect(parseIncludeDerived("true")).toBe(true);
    expect(parseIncludeDerived("false")).toBe(false);
    expect(parseIncludeDerived("1")).toBe(false);
    expect(parseIncludeDerived(undefined)).toBe(false);
  });
});
