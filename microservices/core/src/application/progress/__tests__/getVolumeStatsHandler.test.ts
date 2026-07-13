/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const repoMock = vi.hoisted(() => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  completedSessionCount: vi.fn(async () => 0),
  totalVolume: vi.fn(async () => 0),
  getVolumeByMuscle: vi.fn(async () => [] as any[]),
  recomputeVolumeByMuscle: vi.fn(async () => undefined),
}));

vi.mock("../../repositories/volumeRepository", () => ({
  VolumeRepository: vi.fn().mockImplementation(() => repoMock),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? { sub: "u1", email: "e", email_verified: true, iat: 0, exp: 9e9 }
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

import { getVolumeStatsHandler } from "../getVolumeStatsHandler";

describe("getVolumeStatsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Freeze the clock: the handler derives the window start from `new Date()`,
    // so the "month" window start assertion below ("2026-06-01") depends on the
    // real date. Without this the test passed only during June (it broke when
    // the date rolled to July). Mid-month avoids any TZ-boundary ambiguity.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("returns workouts, tonnes, adherence + by-muscle pct", async () => {
    repoMock.completedSessionCount.mockResolvedValue(18);
    repoMock.totalVolume.mockResolvedValue(62400);
    repoMock.getVolumeByMuscle.mockResolvedValue([
      { muscle: "legs", kg: 14460 },
      { muscle: "chest", kg: 7230 },
    ]);

    const res = await getVolumeStatsHandler.handle(
      new Request("http://localhost/users/me/volume-stats?window=month", {
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.workouts).toBe(18);
    expect(data.totalTonnes).toBe(62.4);
    expect(data.byMuscle[0]).toEqual({ muscle: "legs", kg: 14460, pct: 1 });
    expect(data.byMuscle[1].pct).toBe(0.5);
    expect(data.adherencePct).not.toBeNull();
    // Always recomputes the requested window before reading so by-muscle never
    // goes stale vs the live workouts/totalKg headline (Inspector finding).
    expect(repoMock.recomputeVolumeByMuscle).toHaveBeenCalledWith(
      "u1",
      "Europe/London",
      "month",
      "2026-06-01",
      expect.any(String), // bounded windowEndISO
    );
  });

  it("recomputes the requested window then reads it", async () => {
    repoMock.getVolumeByMuscle.mockResolvedValue([{ muscle: "back", kg: 100 }]);
    const res = await getVolumeStatsHandler.handle(
      new Request("http://localhost/users/me/volume-stats?window=quarter", {
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(res.status).toBe(200);
    expect(repoMock.recomputeVolumeByMuscle).toHaveBeenCalledTimes(1);
    expect(repoMock.recomputeVolumeByMuscle).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "quarter",
      expect.any(String),
      expect.any(String),
    );
  });

  it("returns null adherence for a lifetime window", async () => {
    const res = await getVolumeStatsHandler.handle(
      new Request("http://localhost/users/me/volume-stats?window=lifetime", {
        headers: { authorization: "Bearer t" },
      }),
    );
    const { data } = (await res.json()) as any;
    expect(data.adherencePct).toBeNull();
  });

  describe("recompute guard (Cluster 1a Task 2)", () => {
    it("still returns 200 with live workouts/totalKg + byMuscle: [] when the recompute throws", async () => {
      repoMock.completedSessionCount.mockResolvedValue(9);
      repoMock.totalVolume.mockResolvedValue(31200);
      repoMock.recomputeVolumeByMuscle.mockRejectedValue(
        new Error("materialised-table write failed"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await getVolumeStatsHandler.handle(
        new Request("http://localhost/users/me/volume-stats?window=month", {
          headers: { authorization: "Bearer t" },
        }),
      );

      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      // Live totals still served — computed independently of the recompute.
      expect(data.workouts).toBe(9);
      expect(data.totalTonnes).toBe(31.2);
      // Degrades to an empty by-muscle breakdown rather than 500ing or
      // risking a stale read.
      expect(data.byMuscle).toEqual([]);
      // getVolumeByMuscle is skipped entirely once the recompute has failed
      // — no attempt to read a (potentially stale/half-written) table.
      expect(repoMock.getVolumeByMuscle).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("does not let a recompute failure block adherence/workouts computation for a non-lifetime window", async () => {
      repoMock.completedSessionCount.mockResolvedValue(4);
      repoMock.totalVolume.mockResolvedValue(1000);
      repoMock.recomputeVolumeByMuscle.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await getVolumeStatsHandler.handle(
        new Request("http://localhost/users/me/volume-stats?window=month", {
          headers: { authorization: "Bearer t" },
        }),
      );
      const { data } = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(data.adherencePct).not.toBeNull();
    });
  });
});
