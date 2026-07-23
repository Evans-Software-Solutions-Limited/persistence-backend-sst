/**
 * Client Detail aggregate — wire contract (specs/10-trainer-features/design.md
 * § "Client Detail — functional contract", ~design.md:498–535 + per-module
 * blocks, Phase 4 / PR #164). The `GET /trainers/me/clients/:clientId`
 * aggregate composes modules a–g out of the existing athlete repos called with
 * the CLIENT's userId (never a global query), after the trainer gate.
 *
 * These types are the single source of truth for the payload shape; the
 * repository (`clientDetailRepository.ts`) builds it and the handler is a thin
 * gate + return. Kept in its own module so both the repo and its tests import
 * the shapes without pulling the repo's DB deps.
 */

/** Module a — adherence rating (design.md § Module a). */
export interface AdherenceCategory {
  label: string;
  pct: number | null;
  sub: string;
  available: boolean;
}

export interface AdherenceModule {
  /** 28-day completed-vs-target %, same computation as the roster row. */
  overall: number | null;
  band: "stellar" | "strong" | "wobbling" | "atRisk" | "crisis" | null;
  categories: AdherenceCategory[];
}

/** Module b — PR highlight (design.md § Module b). Exact-rep parity, no Epley. */
export interface PrHighlight {
  type: string; // record_type: 1rm | 3rm | 5rm | 10rm | max_weight | max_volume
  exerciseName: string;
  value: number;
  unit: string; // kg — every shipped record type is weight-derived
  achievedAt: string | null;
}

/** Module c — volume (design.md § Module c). */
export interface VolumeModule {
  weekKg: number | null;
  daily: { date: string; volumeKg: number }[];
}

/** Module d — calorie hit (design.md § Module d). TOTALS ONLY — no entries. */
export interface CalorieHitModule {
  targetKcal: number | null;
  daysHit: number; // days within ±10% this week
  daysLogged: number; // days with any kcal logged, out of 7
  todayKcal: number | null;
  todayRemainingKcal: number | null;
}

/** Module e — goal (design.md § Module e). */
export interface GoalModule {
  id: string;
  title: string; // via goal_types
  unit: string | null;
  targetDate: string | null; // YYYY-MM-DD — seeds the coach edit sheet
  assignedByCoach: boolean; // assigned_by_user_id === trainerId
  weight: {
    startKg: number | null;
    nowKg: number | null;
    targetKg: number | null;
  };
  pct: number | null;
}

/** Module f — habits (design.md § Module f + cross-cuts § 3.7). */
export interface HabitSatisfaction {
  goalId: string;
  label: string; // goal_types.name
  category: string; // habit_configs.category
  met: boolean; // this habit's WEEK met (weekMet, collection.ts)
  /** Progress toward the week's requirement, clamped 0..1. */
  pct: number;
  /** The configured target value (e.g. 5000 for steps, 2 for water). */
  targetValue: number;
  /** Display unit (e.g. "steps", "l", "h", "x"). */
  unit: string;
}

export interface HabitsModule {
  habits: HabitSatisfaction[];
  /** Weekly collection streak current count (their habit user_streaks row). */
  collectionStreak: number;
  /** Whether every enabled habit's week is currently met. */
  collectionSatisfied: boolean;
}

/** Module g — AI summary (design.md § Module g). Phase-5 STUB only. */
export interface AiSummaryModule {
  summary: string | null;
  coversDate: string | null;
  generatedAt: string | null;
  canManualRefresh: boolean;
}

export interface ClientDetailHeader {
  id: string;
  name: string; // profiles.full_name
  initials: string;
  avatarUrl: string | null;
  status: "active" | "pending";
  ageYears: number | null; // from profiles.date_of_birth; null if absent
  heightCm: number | null; // profiles.height_cm; null if absent
  /** profiles.preferred_units — the CLIENT's own display-unit preference
   *  (device-QA follow-up: coach edit-targets water field should follow the
   *  client's unit, not the coach's). Null when unset/unresolved. */
  preferredUnits: "metric" | "imperial" | null;
}

export interface ClientDetailThisWeek {
  workoutsCompleted: number;
  workoutsPlanned: number | null; // from the active programme's weekly schedule
  volumeKg: number | null;
  prs: number;
  checkIns: number | null; // null until habits/HealthKit feed it
}

export interface ClientDetailRecentSession {
  id: string;
  name: string | null;
  completedAt: string;
  volumeKg: number | null;
}

export interface ClientDetailNote {
  id: string;
  noteType: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface ClientDetail {
  client: ClientDetailHeader;
  adherence: AdherenceModule; // module a
  prs: PrHighlight[]; // module b
  volume: VolumeModule; // module c
  calorieHit: CalorieHitModule | null; // module d
  goal: GoalModule | null; // module e
  habits: HabitsModule | null; // module f
  aiSummary: AiSummaryModule; // module g (stub)
  thisWeek: ClientDetailThisWeek;
  recentSessions: ClientDetailRecentSession[];
  notes: ClientDetailNote[];
}

// ─── Pure helpers (exported for unit testing) ──────────────────────────────

/**
 * Age in whole years from a `date_of_birth` string (YYYY-MM-DD or ISO), against
 * `now`. Returns null when the input is missing/unparseable or nonsensical
 * (future DOB → clamped to null rather than a negative age).
 */
export function ageYearsFrom(
  dob: string | null | undefined,
  now: Date,
): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const m = now.getUTCMonth() - born.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age < 0 ? null : age;
}

/**
 * The calorie-adherence category percentage from module d: hit days / logged
 * days, as a 0..100 integer. `daysLogged === 0` → null (nothing to rate yet).
 */
export function calorieCategoryPct(
  daysHit: number,
  daysLogged: number,
): number | null {
  if (daysLogged <= 0) return null;
  return Math.round((daysHit / daysLogged) * 100);
}

/**
 * Weight-goal progress fraction, clamped 0..1. `null` when not computable
 * (missing endpoints, or a start==target axis that would divide by zero).
 */
export function weightGoalPct(
  startKg: number | null,
  nowKg: number | null,
  targetKg: number | null,
): number | null {
  if (startKg == null || nowKg == null || targetKg == null) return null;
  const denom = targetKg - startKg;
  if (denom === 0) return null;
  const raw = (nowKg - startKg) / denom;
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(1, raw));
}

/**
 * How far a single habit's WEEK has progressed toward its requirement, clamped
 * 0..1 (design.md § Module f — the presenter's per-habit ring). Mirrors the
 * `weekMet` denominators in `collection.ts`: `count` habits divide progress by
 * the session target; day-based habits (`value_gte` / `within_tolerance`)
 * divide by `days_per_week`.
 */
export function habitProgressPct(input: {
  completionRule: string;
  targetValue: number;
  daysPerWeek: number | null;
  qualifyingDays: number;
  sessionCount: number;
}): number {
  if (input.completionRule === "count") {
    const need = Math.ceil(input.targetValue);
    if (need <= 0) return 1;
    return Math.max(0, Math.min(1, input.sessionCount / need));
  }
  const need = input.daysPerWeek ?? 1;
  if (need <= 0) return 1;
  return Math.max(0, Math.min(1, input.qualifyingDays / need));
}
