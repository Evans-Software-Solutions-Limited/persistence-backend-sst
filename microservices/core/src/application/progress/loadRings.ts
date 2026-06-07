/**
 * Loads the TodayHero ring inputs (06-progress-goals, Phase 06.5). Shared by
 * GET /users/me/today-rings and GET /users/me/home. Takes the repos as deps so
 * it stays testable without a DB.
 */

import { localDateISO } from "../streaks/period";
import { weekStartISO } from "./window";
import { buildRings, type Rings } from "./rings";
import { addDaysISO } from "../streaks/period";

/** Defaults until per-user goals are wired (flagged): 10k steps, 20t/week. */
export const DEFAULT_GOAL_STEPS = 10000;
export const DEFAULT_TARGET_KG = 20000;

export interface RingPorts {
  getUserTimezone(userId: string): Promise<string>;
  totalVolume(
    userId: string,
    tz: string,
    startISO: string,
    endISO: string,
  ): Promise<number>;
  getTodaySteps(userId: string, todayLocalISO: string): Promise<number>;
}

export async function loadRings(
  ports: RingPorts,
  userId: string,
  now: Date,
): Promise<Rings> {
  const tz = await ports.getUserTimezone(userId);
  const today = localDateISO(now, tz);
  const ws = weekStartISO(now, tz);
  const we = addDaysISO(ws, 6);

  const [steps, weekKg] = await Promise.all([
    ports.getTodaySteps(userId, today),
    ports.totalVolume(userId, tz, ws, we),
  ]);

  return buildRings(steps, DEFAULT_GOAL_STEPS, weekKg, DEFAULT_TARGET_KG);
}
