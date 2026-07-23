/**
 * Client Detail aggregate — mobile domain model (M8 Coach Phase 5).
 *
 * Mirrors the backend wire contract 1:1
 * (microservices/core/src/application/repositories/clientDetail.ts, authored
 * against specs/10-trainer-features/design.md § "Client Detail — functional
 * contract"). The backend emits camelCase, so the wire shape IS the domain
 * shape — the SST adapter unwraps the `{ data }` envelope and passes the
 * payload through without field mapping.
 *
 * Fetched via `GET /trainers/me/clients/:clientId`; consumed by
 * `useGetClientDetail` (cache-first) and `<ClientDetailPresenter>`.
 */

/** Module a — one adherence category row (design.md § Module a). */
export type AdherenceCategory = {
  label: string;
  /** 0..100, or null when the category isn't available yet. */
  pct: number | null;
  /** Caption under the label (e.g. "Last 28 days", "Available with Fuel"). */
  sub: string;
  /** False rows render muted "—" with the `sub` as a hint. */
  available: boolean;
};

/** Module a — adherence rating. */
export type AdherenceModule = {
  /** 28-day completed-vs-target %, or null for a brand-new client. */
  overall: number | null;
  band: "stellar" | "strong" | "wobbling" | "atRisk" | "crisis" | null;
  categories: AdherenceCategory[];
};

/** Module b — a PR highlight (exact-rep parity, no Epley). */
export type PrHighlight = {
  /** record_type: 1rm | 3rm | 5rm | 10rm | max_weight | max_volume */
  type: string;
  exerciseName: string;
  value: number;
  unit: string;
  achievedAt: string | null;
};

/** Module c — training volume. */
export type VolumeModule = {
  weekKg: number | null;
  daily: { date: string; volumeKg: number }[];
};

/** Module d — calorie adherence (TOTALS ONLY — never food-entry rows). */
export type CalorieHitModule = {
  targetKcal: number | null;
  /** Days within ±10% this week. */
  daysHit: number;
  /** Days with any kcal logged, out of 7. */
  daysLogged: number;
  todayKcal: number | null;
  todayRemainingKcal: number | null;
};

/** Module e — primary goal + weight axis. */
export type GoalModule = {
  id: string;
  /** via goal_types.name */
  title: string;
  unit: string | null;
  /** YYYY-MM-DD — seeds the coach edit sheet. */
  targetDate: string | null;
  /** assigned_by_user_id === trainerId */
  assignedByCoach: boolean;
  weight: {
    startKg: number | null;
    nowKg: number | null;
    targetKg: number | null;
  };
  /** Progress fraction 0..1, or null when not computable. */
  pct: number | null;
};

/** Module f — one habit's weekly satisfaction (design.md § Module f). */
export type HabitSatisfaction = {
  goalId: string;
  label: string;
  category: string;
  /** This habit's week is currently met. */
  met: boolean;
  /** Progress toward the week's requirement, 0..1. */
  pct: number;
};

/** Module f — habits + weekly collection streak. */
export type HabitsModule = {
  habits: HabitSatisfaction[];
  collectionStreak: number;
  collectionSatisfied: boolean;
};

/** Module g — AI summary. Phase-5 STUB (all null / locked). */
export type AiSummaryModule = {
  summary: string | null;
  coversDate: string | null;
  generatedAt: string | null;
  canManualRefresh: boolean;
};

export type ClientDetailHeader = {
  id: string;
  /** profiles.full_name */
  name: string;
  initials: string;
  avatarUrl: string | null;
  status: "active" | "pending";
  ageYears: number | null;
  heightCm: number | null;
  /** profiles.preferred_units — the CLIENT's own display-unit preference
   *  (device-QA follow-up: coach edit-targets water field follows the
   *  client's unit, defaulting to litres). Null when unset/unresolved. */
  preferredUnits: "metric" | "imperial" | null;
};

export type ClientDetailThisWeek = {
  workoutsCompleted: number;
  /** From the active programme's weekly schedule; null when no programme. */
  workoutsPlanned: number | null;
  volumeKg: number | null;
  prs: number;
  /** null until habits/HealthKit feed it. */
  checkIns: number | null;
};

export type ClientDetailRecentSession = {
  id: string;
  name: string | null;
  completedAt: string;
  /** Always null this phase. */
  volumeKg: number | null;
};

export type ClientDetailNote = {
  id: string;
  noteType: string;
  title: string;
  content: string;
  createdAt: string;
};

export type ClientDetail = {
  client: ClientDetailHeader;
  adherence: AdherenceModule;
  prs: PrHighlight[];
  volume: VolumeModule;
  calorieHit: CalorieHitModule | null;
  goal: GoalModule | null;
  habits: HabitsModule | null;
  aiSummary: AiSummaryModule;
  thisWeek: ClientDetailThisWeek;
  recentSessions: ClientDetailRecentSession[];
  notes: ClientDetailNote[];
};
