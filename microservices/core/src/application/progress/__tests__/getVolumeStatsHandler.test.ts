/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  beforeEach(() => vi.clearAllMocks());

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
});
