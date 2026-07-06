/**
 * Progress/Home read-payload models (06-progress-goals, Phase 06.6). These
 * mirror the M4 backend endpoint shapes (today-rings, home, weekly-volume,
 * volume-stats, body-trend) so the adapters parse one envelope each.
 */

import type { PersonalRecord } from "./record";
import type { Habit } from "./habit-completion";

export type RingDatum = {
  current: number;
  target: number;
  pct: number; // 0..1
  unit: string;
};

/** Fuel gates on M9 — "gated" renders 0% fill + "--". */
export type Rings = {
  move: RingDatum;
  train: RingDatum;
  fuel: RingDatum | "gated";
  todayPct: number; // 0..100, centre label
};

export type MicroPills = {
  streak: number;
  water: string | null;
  strain: number | null;
  sleep: string | null;
};

export type WeeklyVolumeDay = {
  date: string;
  volumeKg: number;
  isToday: boolean;
  isRest: boolean;
};

export type WeeklyVolume = {
  days: WeeklyVolumeDay[];
  totalKg: number;
  deltaPct: number | null;
  workouts: { completed: number; target: number };
};

export type MuscleVolume = {
  muscle: string;
  kg: number;
  pct: number; // 0..1 relative to the largest muscle
};

export type VolumeStats = {
  window: "month" | "quarter" | "year" | "lifetime";
  workouts: number;
  totalKg: number;
  totalTonnes: number;
  adherencePct: number | null;
  byMuscle: MuscleVolume[];
};

export type BodyTrendPoint = {
  date: string;
  weightKg: number | null;
  bodyFat: number | null;
};

/**
 * The athlete's currently-active programme (19-programs, Phase 9 F2). Null
 * when the athlete has no live programme assignment. `week`/`totalWeeks`
 * feed the same segmented-progress-bar shape as the coach's `ProgrammeCard`
 * (`totalWeeks: null` = indefinite/ongoing — render "Week N · Ongoing").
 */
export type ActiveProgramme = {
  assignmentId: string;
  programId: string;
  name: string;
  week: number;
  totalWeeks: number | null;
  endDate: string | null;
  startDate: string;
};

/**
 * A due-ordered "Today's training" row (19-programs, Phase 9 F2) — a
 * workout assigned to the athlete either via a live programme assignment
 * (`assignmentId` set) or a standalone coach workout-assignment.
 * `assignedByType` attributes the row to a trainer/physio badge; null for
 * self-assigned/programme-only rows without a distinct assigner.
 */
export type TodaysTrainingItem = {
  assignmentId: string | null;
  workoutId: string;
  name: string | null;
  estimatedDurationMinutes: number | null;
  dueDate: string | null;
  assignedByType: "personal_trainer" | "physiotherapist" | null;
};

/** Aggregate cold-start payload for Home (GET /users/me/home). */
export type HomePayload = {
  rings: Rings;
  micro: MicroPills;
  weeklyVolume: WeeklyVolume;
  recentPRs: PersonalRecord[];
  habits: Habit[];
  todayWorkout: unknown[];
  /** 19-programs Phase 9 F2 — null when no live programme assignment. */
  activeProgramme: ActiveProgramme | null;
  /** 19-programs Phase 9 F2 — due-ordered; empty when nothing is assigned. */
  todaysTraining: TodaysTrainingItem[];
};

export const HOME_STALE_AFTER_MS = 5 * 60 * 1000; // 5 min, matches dashboard

export function isHomeStale(syncedAtIso: string | null, now: number): boolean {
  if (!syncedAtIso) return true;
  return now - new Date(syncedAtIso).getTime() > HOME_STALE_AFTER_MS;
}
