/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const habitMock = {
  create: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  goalBelongsToUser: vi.fn(async () => true),
};
const evaluateMock = vi
  .fn()
  .mockResolvedValue({ advanced: [], milestones: [] });

vi.mock("../../repositories/habitRepository", () => ({
  HabitRepository: vi.fn().mockImplementation(() => habitMock),
}));
vi.mock("../../streaks/evaluate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../streaks/evaluate")>();
  return {
    ...actual, // keep the real resolveEventTs (clamp logic under test)
    safeEvaluateStreaks: (...args: unknown[]) => evaluateMock(...args),
  };
});
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

function post(body: unknown, auth = true) {
  return new Request("http://localhost/habit-completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("createHabitCompletionHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1" }, false),
    );
    expect(res.status).toBe(401);
  });

  it("creates a completion, triggers the streak engine, returns 201", async () => {
    habitMock.create.mockResolvedValue({ id: "h1", goalId: "g1" });
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1", date: "2026-06-07T12:00:00Z", value: 3 }),
    );
    expect(res.status).toBe(201);
    expect(habitMock.create).toHaveBeenCalledWith("u1", {
      goalId: "g1",
      completedAt: new Date("2026-06-07T12:00:00Z"),
      value: 3,
    });
    expect(evaluateMock).toHaveBeenCalledWith(
      "u1",
      "habit_completed",
      new Date("2026-06-07T12:00:00Z"),
    );
  });

  it("defaults completedAt to now when no date is given", async () => {
    habitMock.create.mockResolvedValue({ id: "h2", goalId: "g1" });
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1" }),
    );
    expect(res.status).toBe(201);
    const arg = habitMock.create.mock.calls[0][1];
    expect(arg.completedAt).toBeInstanceOf(Date);
    expect(arg.value).toBeNull();
  });

  it("rejects a malformed date with 400 (not a 500)", async () => {
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1", date: "not-a-date" }),
    );
    expect(res.status).toBe(400);
    expect(habitMock.create).not.toHaveBeenCalled();
  });

  it("clamps a future date to now (no future streak grief)", async () => {
    habitMock.create.mockResolvedValue({ id: "h3", goalId: "g1" });
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const before = Date.now();
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1", date: "2099-01-01T00:00:00Z" }),
    );
    expect(res.status).toBe(201);
    // Both the stored completedAt AND the streak event are clamped to ~now,
    // never the 2099 input.
    const stored = habitMock.create.mock.calls[0][1].completedAt as Date;
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now());
    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
    expect(evaluateMock).toHaveBeenCalledWith("u1", "habit_completed", stored);
  });

  it("passes a date-only day through as the authoritative localDate", async () => {
    habitMock.create.mockResolvedValue({ id: "h4", goalId: "g1" });
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1", date: "2026-06-04" }),
    );
    expect(res.status).toBe(201);
    const arg = habitMock.create.mock.calls[0][1];
    // The tapped cell IS the user-local day — never converted via an instant.
    expect(arg.localDate).toBe("2026-06-04");
    // Stored instant anchored at noon UTC of that day.
    expect((arg.completedAt as Date).toISOString()).toBe(
      "2026-06-04T12:00:00.000Z",
    );
  });

  it("rejects a future date-only day with 400", async () => {
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "g1", date: "2099-01-01" }),
    );
    expect(res.status).toBe(400);
    expect(habitMock.create).not.toHaveBeenCalled();
  });

  it("404s when the goal is not owned by the caller", async () => {
    habitMock.goalBelongsToUser.mockResolvedValueOnce(false);
    const { createHabitCompletionHandler } =
      await import("../createHabitCompletionHandler");
    const res = await createHabitCompletionHandler.handle(
      post({ goalId: "someone-elses-goal" }),
    );
    expect(res.status).toBe(404);
    expect(habitMock.create).not.toHaveBeenCalled();
  });
});
