/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMock = {
  getUserTimezone: vi.fn(async () => "Europe/London"),
  recomputeWeeklyVolume: vi.fn(async () => undefined),
  recomputeVolumeByMuscle: vi.fn(async () => undefined),
};

vi.mock("../../repositories/volumeRepository", () => ({
  VolumeRepository: vi.fn().mockImplementation(() => repoMock),
}));

import { recomputeUserVolume, safeRecomputeVolume } from "../recompute";

const NOW = new Date("2026-06-10T12:00:00Z"); // Wed

describe("recomputeUserVolume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recomputes the current week + current month for the user", async () => {
    await recomputeUserVolume(repoMock as any, "u1", NOW);
    expect(repoMock.recomputeWeeklyVolume).toHaveBeenCalledWith(
      "u1",
      "Europe/London",
      "2026-06-08",
      "2026-06-14",
    );
    expect(repoMock.recomputeVolumeByMuscle).toHaveBeenCalledWith(
      "u1",
      "Europe/London",
      "month",
      "2026-06-01",
    );
  });
});

describe("safeRecomputeVolume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs without throwing on success", async () => {
    await expect(safeRecomputeVolume("u1", NOW)).resolves.toBeUndefined();
    expect(repoMock.recomputeWeeklyVolume).toHaveBeenCalled();
  });

  it("swallows errors and logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    repoMock.getUserTimezone.mockRejectedValueOnce(new Error("db down"));
    await expect(safeRecomputeVolume("u1", NOW)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
