/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMock = vi.hoisted(() => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  dailyVolume: vi.fn(async () => [] as any[]),
  totalVolume: vi.fn(async () => 0),
  completedSessionCount: vi.fn(async () => 0),
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

import { getWeeklyVolumeHandler } from "../getWeeklyVolumeHandler";

describe("getWeeklyVolumeHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 7 day-bars + header stats", async () => {
    repoMock.dailyVolume.mockResolvedValue([
      { date: "2026-06-10", volumeKg: 900 },
    ]);
    repoMock.totalVolume
      .mockResolvedValueOnce(8000) // this week
      .mockResolvedValueOnce(7000); // last week
    repoMock.completedSessionCount.mockResolvedValue(4);

    const res = await getWeeklyVolumeHandler.handle(
      new Request("http://localhost/users/me/weekly-volume?window=7d", {
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.days).toHaveLength(7);
    expect(data.totalKg).toBe(8000);
    expect(data.deltaPct).toBe(14); // (8000-7000)/7000
    expect(data.workouts).toEqual({ completed: 4, target: 5 });
  });

  it("requires authentication", async () => {
    const res = await getWeeklyVolumeHandler.handle(
      new Request("http://localhost/users/me/weekly-volume"),
    );
    expect(res.status).toBe(401);
  });
});
