/**
 * Nightly volume re-materialisation sweep (06-progress-goals, Phase 06.4).
 * Scheduled at 03:00 UTC (infra/api.ts). Recomputes the current-week +
 * current-month aggregates for every user with completed sessions. Per-user
 * errors are isolated so one bad user doesn't abort the sweep.
 */

import type { VolumeRepository } from "../repositories/volumeRepository";
import { recomputeUserVolume } from "./recompute";

export interface VolumeCronDeps {
  repo: VolumeRepository;
  now: Date;
}

export interface VolumeCronSummary {
  users: number;
  recomputed: number;
  failed: number;
}

export async function volumeCron(
  deps: VolumeCronDeps,
): Promise<VolumeCronSummary> {
  const userIds = await deps.repo.userIdsWithCompletedSessions();
  const summary: VolumeCronSummary = {
    users: userIds.length,
    recomputed: 0,
    failed: 0,
  };

  for (const userId of userIds) {
    try {
      await recomputeUserVolume(deps.repo, userId, deps.now);
      summary.recomputed += 1;
    } catch (err) {
      summary.failed += 1;
      console.error("[volume-cron] recompute failed", { userId, error: err });
    }
  }

  return summary;
}
