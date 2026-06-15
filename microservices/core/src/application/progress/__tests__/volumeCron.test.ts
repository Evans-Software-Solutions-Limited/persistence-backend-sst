/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { volumeCron } from "../volumeCron";

const NOW = new Date("2026-06-10T12:00:00Z");

function makeRepo(userIds: string[]) {
  return {
    userIdsWithCompletedSessions: vi.fn(async () => userIds),
    getUserTimezone: vi.fn(async () => "Europe/London"),
    recomputeWeeklyVolume: vi.fn(async () => undefined),
    recomputeVolumeByMuscle: vi.fn(async () => undefined),
  };
}

describe("volumeCron", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recomputes every active user", async () => {
    const repo = makeRepo(["u1", "u2"]);
    const summary = await volumeCron({ repo: repo as any, now: NOW });
    expect(summary).toEqual({ users: 2, recomputed: 2, failed: 0 });
    expect(repo.recomputeWeeklyVolume).toHaveBeenCalledTimes(2);
  });

  it("isolates a per-user failure without aborting the sweep", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = makeRepo(["good", "bad"]);
    (repo.getUserTimezone as any).mockImplementation(async (userId: string) => {
      if (userId === "bad") throw new Error("boom");
      return "Europe/London";
    });
    const summary = await volumeCron({ repo: repo as any, now: NOW });
    expect(summary).toEqual({ users: 2, recomputed: 1, failed: 1 });
    spy.mockRestore();
  });
});
