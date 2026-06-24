/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../engine", () => ({ evaluateStreaks: vi.fn() }));
import { evaluateStreaks } from "../engine";
import { nutritionStreakCron } from "../nutritionCron";

const now = new Date("2026-06-23T02:00:00.000Z");
const notifier = { notify: vi.fn() };

function makeData(userIds: string[], tzByUser: Record<string, string>): any {
  return {
    getNutritionStreakUserIds: vi.fn().mockResolvedValue(userIds),
    getUserTimezone: vi.fn(async (u: string) => tzByUser[u] ?? "Europe/London"),
  };
}

describe("nutritionStreakCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (evaluateStreaks as any).mockResolvedValue({
      advanced: [],
      milestones: [],
    });
  });

  it("does nothing when no user has a nutrition streak", async () => {
    const data = makeData([], {});
    const out = await nutritionStreakCron({ data, notifier, now });
    expect(out).toEqual({ users: 0, advanced: 0, failed: 0 });
    expect(evaluateStreaks).not.toHaveBeenCalled();
  });

  it("evaluates each user's just-completed LOCAL day (timezone-correct)", async () => {
    const data = makeData(["uLondon", "uLA"], {
      uLondon: "Europe/London", // 02:00Z = 03:00 local 23rd → yesterday 22nd
      uLA: "America/Los_Angeles", // 02:00Z = 19:00 local 22nd → yesterday 21st
    });
    (evaluateStreaks as any).mockResolvedValue({
      advanced: [{ id: "s" }],
      milestones: [],
    });

    const out = await nutritionStreakCron({ data, notifier, now });

    expect(out).toEqual({ users: 2, advanced: 2, failed: 0 });
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "uLondon",
      "nutrition_in_target",
      now,
      { data, notifier },
      { localDate: "2026-06-22" },
    );
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "uLA",
      "nutrition_in_target",
      now,
      { data, notifier },
      { localDate: "2026-06-21" },
    );
  });

  it("isolates a per-user failure and keeps going", async () => {
    const data = makeData(["bad", "good"], { good: "Europe/London" });
    data.getUserTimezone = vi.fn(async (u: string) => {
      if (u === "bad") throw new Error("boom");
      return "Europe/London";
    });
    (evaluateStreaks as any).mockResolvedValue({
      advanced: [{ id: "s" }],
      milestones: [],
    });

    const out = await nutritionStreakCron({ data, notifier, now });
    expect(out.failed).toBe(1);
    expect(out.advanced).toBe(1); // the good user still advanced
    expect(out.users).toBe(2);
  });
});
