import {
  estimateOneRepMax,
  exerciseVolumes,
  MUSCLE_DISPLAY_GROUPS,
  MUSCLE_TO_GROUP,
  sessionTotals,
  topLifts,
  trainNextAndRest,
  windowMuscles,
  windowTotals,
  type MuscleCreditRow,
  type MuscleDisplayGroup,
  type TrainingExercise,
  type TrainingSession,
} from "@persistence/training-metrics";
import { addDaysISO, localDateISO } from "../streaks/period";
import { weekStartISO } from "../progress/window";
import type { DayLog, WindowRecord } from "./trainingReadRepository";

/**
 * Pure response builders for the design H reads (PER-113). The maths comes
 * from `@persistence/training-metrics`, the package the phone uses too, so
 * a window the phone builds from its own log and the same window from here
 * agree (shared fixtures, design H test 5).
 */

export type LocalWindow = { from: string; to: string };

export const MAX_VOLUME_DAYS = 92;

/** `?days=` for muscle-volume: a whole number from 1 to 92, default 7. */
export function parseDays(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 7;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_VOLUME_DAYS ? n : null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM` → its first and last day, or null. */
export function parseMonth(raw: string): LocalWindow | null {
  const m = MONTH.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${raw}-01`,
    to: `${raw}-${String(last).padStart(2, "0")}`,
  };
}

/** A real calendar `YYYY-MM-DD`, or null. */
export function parseDate(raw: string): string | null {
  if (!DATE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return d.toISOString().slice(0, 10) === raw ? raw : null;
}

/** The last `days` local days, today included. */
export function lastDays(now: Date, tz: string, days: number): LocalWindow {
  const to = localDateISO(now, tz);
  return { from: addDaysISO(to, -(days - 1)), to };
}

export type RecapPeriod = "week" | "month" | "3months";
export const RECAP_PERIODS: readonly RecapPeriod[] = [
  "week",
  "month",
  "3months",
];

const firstOfMonth = (iso: string, monthsBack: number): string => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
};

/** The recap's window (ending today) and the same kind of window before it. */
export function recapWindows(
  period: RecapPeriod,
  now: Date,
  tz: string,
): { current: LocalWindow; previous: LocalWindow } {
  const today = localDateISO(now, tz);
  if (period === "week") {
    const from = weekStartISO(now, tz);
    return {
      current: { from, to: today },
      previous: { from: addDaysISO(from, -7), to: addDaysISO(from, -1) },
    };
  }
  const months = period === "month" ? 1 : 3;
  const from = firstOfMonth(today, months - 1);
  return {
    current: { from, to: today },
    previous: { from: firstOfMonth(from, months), to: addDaysISO(from, -1) },
  };
}

/** The owner's local day a workout started on. */
export const sessionDay = (s: TrainingSession, tz: string) =>
  localDateISO(new Date(s.startedAt), tz);

const inWindow = (
  sessions: readonly TrainingSession[],
  w: LocalWindow,
  tz: string,
) =>
  sessions.filter((s) => {
    const d = sessionDay(s, tz);
    return d >= w.from && d <= w.to;
  });

/** A credit row on the wire: `muscle` is the display group. */
export function muscleRow(r: MuscleCreditRow) {
  return {
    muscle: r.group,
    label: r.label,
    credit: r.credit,
    hardSets: r.hardSets,
    weeklyGuide: r.weeklyGuide,
    ratio: r.ratio,
    share: r.share,
    level: r.level,
  };
}

const recordIds = (records: readonly WindowRecord[]) =>
  new Set(records.map((r) => r.exerciseId));

/** `GET /users/me/muscle-volume` (Y1 muscles, Train next / Rest, strip). */
export function muscleVolumeModel(p: {
  window: LocalWindow;
  days: number;
  timezone: string;
  bodyType: "male" | "female";
  sessions: readonly TrainingSession[];
  records: readonly WindowRecord[];
  asOf: string;
}) {
  const rows = windowMuscles(p.sessions);
  const split = trainNextAndRest(rows);
  return {
    days: p.days,
    from: p.window.from,
    to: p.window.to,
    timezone: p.timezone,
    bodyType: p.bodyType,
    muscles: rows.map(muscleRow),
    trainNext: split.trainNext.map((r) => r.group),
    rest: split.rest.map((r) => r.group),
    totals: windowTotals(p.sessions),
    topLifts: topLifts(p.sessions, recordIds(p.records)),
    // So the phone can tell whether this answer includes every workout it
    // holds (one finished offline may not have synced yet).
    sessionIds: p.sessions.map((s) => s.id),
    asOf: p.asOf,
  };
}

const logged = (d: DayLog | undefined) =>
  !!d &&
  (d.kcal > 0 ||
    d.waterCups > 0 ||
    d.steps != null ||
    d.weightKg != null ||
    d.habits.length > 0);

/** `GET /users/me/history?month=` — what was logged on each day. */
export function historyMonthModel(p: {
  month: string;
  window: LocalWindow;
  timezone: string;
  sessions: readonly TrainingSession[];
  logs: ReadonlyMap<string, DayLog>;
  asOf: string;
}) {
  const workouts = new Map<string, number>();
  for (const s of p.sessions) {
    const d = sessionDay(s, p.timezone);
    workouts.set(d, (workouts.get(d) ?? 0) + 1);
  }
  const keys = [...new Set([...workouts.keys(), ...p.logs.keys()])]
    .filter((d) => d >= p.window.from && d <= p.window.to)
    .sort();
  const days = keys.flatMap((date) => {
    const log = p.logs.get(date);
    const w = workouts.get(date) ?? 0;
    if (!w && !logged(log)) return [];
    return [
      {
        date,
        workouts: w,
        food: !!log && (log.kcal > 0 || log.waterCups > 0),
        steps: log?.steps != null,
        weight: log?.weightKg != null,
        habits: (log?.habits.length ?? 0) > 0,
      },
    ];
  });
  return {
    month: p.month,
    timezone: p.timezone,
    from: p.window.from,
    to: p.window.to,
    loggedDays: days.map((d) => d.date),
    days,
    asOf: p.asOf,
  };
}

/** Within ±10% of the target (design B). */
export function calorieResult(
  kcal: number | null,
  target: number | null,
): "on" | "over" | "under" | "notLogged" | "noTarget" {
  if (kcal == null) return "notLogged";
  if (target == null || target <= 0) return "noTarget";
  if (Math.abs(kcal - target) <= 0.1 * target) return "on";
  return kcal > target ? "over" : "under";
}

/** `GET /users/me/history?date=` — one day's breakdown (Y2). */
export function historyDayModel(p: {
  date: string;
  timezone: string;
  sessions: readonly TrainingSession[];
  records: readonly WindowRecord[];
  log: DayLog | undefined;
  target: { dailyKcal: number | null; source: "current" | "history" };
  asOf: string;
}) {
  const kcal = p.log && p.log.kcal > 0 ? p.log.kcal : null;
  return {
    date: p.date,
    timezone: p.timezone,
    workouts: p.sessions.map((s) => {
      const t = sessionTotals(s);
      return {
        id: s.id,
        name: s.name,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationSeconds: t.durationSeconds,
        volumeKg: t.volumeKg,
        sets: t.sets,
        records: p.records.filter((r) => r.sessionId === s.id).length,
        // The workout itself, so the phone can open its summary (Y2b) when
        // its own log never held it (an older month, a new phone).
        exercises: s.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          name: e.name,
          isSubstituted: e.isSubstituted,
          sets: e.sets,
        })),
      };
    }),
    muscles: windowMuscles(p.sessions).map(muscleRow),
    totals: windowTotals(p.sessions),
    calories: {
      kcal,
      targetKcal: p.target.dailyKcal,
      result: calorieResult(kcal, p.target.dailyKcal),
      // "current": judged against today's target, because target history
      // (BE-B1, PER-114) isn't built yet. Becomes "history" — the target in
      // force that day — once it is.
      targetSource: p.target.source,
    },
    steps: p.log?.steps ?? null,
    weightKg: p.log?.weightKg ?? null,
    waterCups: p.log?.waterCups ?? 0,
    sleepHours: p.log?.sleepHours ?? null,
    habits: p.log?.habits ?? [],
    asOf: p.asOf,
  };
}

/** `GET /users/me/recap?period=` — the Y4 pages, as the phone builds them. */
export function recapModel(p: {
  period: RecapPeriod;
  windows: { current: LocalWindow; previous: LocalWindow };
  timezone: string;
  sessions: readonly TrainingSession[];
  records: readonly WindowRecord[];
  together: { sessionIds: readonly string[]; names: readonly string[] };
  asOf: string;
}) {
  const current = inWindow(p.sessions, p.windows.current, p.timezone);
  const previous = inWindow(p.sessions, p.windows.previous, p.timezone);
  const records = p.records.filter(
    (r) =>
      localDateISO(new Date(r.achievedAt), p.timezone) >=
      p.windows.current.from,
  );
  const togetherIds = new Set(p.together.sessionIds);
  return {
    period: p.period,
    timezone: p.timezone,
    from: p.windows.current.from,
    to: p.windows.current.to,
    previousFrom: p.windows.previous.from,
    previousTo: p.windows.previous.to,
    totals: windowTotals(current),
    previous: windowTotals(previous),
    sessionIds: current.map((s) => s.id),
    muscles: windowMuscles(current).map(muscleRow),
    lifts: topLifts(current, recordIds(records)),
    volume: exerciseVolumes(current),
    records,
    together: {
      sessions: current.filter((s) => togetherIds.has(s.id)).length,
      names: [...p.together.names],
    },
    asOf: p.asOf,
  };
}

// ─── Coach training review (C3 / C3.1) ───────────────────────────────────────

export type ReviewWindow = "7d" | "28d";

const primaryGroups = (e: TrainingExercise): Set<MuscleDisplayGroup> =>
  new Set(
    e.primary.flatMap((m) => {
      const g = MUSCLE_TO_GROUP[m];
      return g ? [g] : [];
    }),
  );

const counted = (e: TrainingExercise) => !e.isSubstituted && !e.skipped;

const bestOneRepMax = (e: TrainingExercise): number | null => {
  let best: number | null = null;
  for (const s of e.sets) {
    if (!s.isCompleted || s.weightKg == null || s.reps == null) continue;
    const orm = estimateOneRepMax(s.weightKg, s.reps);
    if (orm != null && (best == null || orm > best)) best = orm;
  }
  return best;
};

/**
 * `GET /trainers/me/clients/:clientId/training-review`.
 *
 * - **worked** (the window): each trained group's hard sets (whole sets
 *   where it was primary), the weight lifted in those sets, and `pr` when a
 *   record in the window was on a lift that trains it as a primary muscle.
 *   Credit and shade level come from the shared function. Most sets first.
 * - **strength** (always 4 weeks): per group, its main lift — the exercise
 *   training it as a primary muscle with the most 1RM-estimable sets — and
 *   the change in that lift's best estimated 1RM from its first workout in
 *   the 4 weeks to its latest (null with only one workout). `record` = a
 *   record on that lift in the last 7 days.
 * - **prsHit**: records in the window, newest first, with the groups their
 *   lift trains.
 */
export function trainingReviewModel(p: {
  window: ReviewWindow;
  windows: { review: LocalWindow; strength: LocalWindow; week: LocalWindow };
  timezone: string;
  bodyType: "male" | "female";
  /** Every workout in the 4-week strength window (covers the review). */
  sessions: readonly TrainingSession[];
  /** Records in the 4-week strength window. */
  records: readonly WindowRecord[];
  asOf: string;
}) {
  const recordDay = (r: WindowRecord) =>
    localDateISO(new Date(r.achievedAt), p.timezone);
  const reviewSessions = inWindow(p.sessions, p.windows.review, p.timezone);
  const reviewRecords = p.records.filter(
    (r) => recordDay(r) >= p.windows.review.from,
  );
  const weekRecordIds = new Set(
    p.records
      .filter((r) => recordDay(r) >= p.windows.week.from)
      .map((r) => r.exerciseId),
  );

  // Which groups each exercise trains as a primary muscle (by any workout).
  const groupsOf = new Map<string, Set<MuscleDisplayGroup>>();
  for (const s of p.sessions)
    for (const e of s.exercises)
      if (!groupsOf.has(e.exerciseId))
        groupsOf.set(e.exerciseId, primaryGroups(e));

  // Worked.
  const volume = new Map<MuscleDisplayGroup, number>();
  for (const s of reviewSessions)
    for (const e of s.exercises.filter(counted)) {
      let v = 0;
      for (const set of e.sets)
        if (set.isCompleted && (set.reps ?? 0) > 0 && set.weightKg != null)
          v += set.weightKg * set.reps!;
      for (const g of primaryGroups(e)) volume.set(g, (volume.get(g) ?? 0) + v);
    }
  const prGroups = new Set<MuscleDisplayGroup>();
  for (const r of reviewRecords)
    for (const g of groupsOf.get(r.exerciseId) ?? []) prGroups.add(g);
  const worked = windowMuscles(reviewSessions)
    .filter((r) => r.credit > 0)
    .sort((a, b) => b.hardSets - a.hardSets || b.credit - a.credit)
    .map((r) => ({
      ...muscleRow(r),
      volumeKg: volume.get(r.group) ?? 0,
      pr: prGroups.has(r.group),
    }));

  // Strength over 4 weeks.
  type Lift = {
    exerciseId: string;
    name: string;
    sets: number;
    first: number | null;
    latest: number | null;
    sessions: number;
    best: number;
  };
  const lifts = new Map<MuscleDisplayGroup, Map<string, Lift>>();
  const ordered = [...p.sessions].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  for (const s of ordered)
    for (const e of s.exercises.filter(counted)) {
      const orm = bestOneRepMax(e);
      if (orm == null) continue;
      const estimable = e.sets.filter(
        (set) =>
          set.isCompleted &&
          set.weightKg != null &&
          set.reps != null &&
          estimateOneRepMax(set.weightKg, set.reps) != null,
      ).length;
      for (const g of primaryGroups(e)) {
        const byLift = lifts.get(g) ?? new Map<string, Lift>();
        const l = byLift.get(e.exerciseId) ?? {
          exerciseId: e.exerciseId,
          name: e.name,
          sets: 0,
          first: null,
          latest: null,
          sessions: 0,
          best: 0,
        };
        l.sets += estimable;
        l.first ??= orm;
        l.latest = orm;
        l.sessions += 1;
        l.best = Math.max(l.best, orm);
        byLift.set(e.exerciseId, l);
        lifts.set(g, byLift);
      }
    }
  const strength = MUSCLE_DISPLAY_GROUPS.flatMap((group) => {
    const byLift = lifts.get(group);
    if (!byLift) return [];
    const main = [...byLift.values()].sort(
      (a, b) =>
        b.sets - a.sets || b.best - a.best || a.name.localeCompare(b.name),
    )[0]!;
    const change =
      main.sessions > 1 && main.first
        ? ((main.latest! - main.first) / main.first) * 100
        : null;
    return [
      {
        muscle: group,
        exerciseId: main.exerciseId,
        lift: main.name,
        oneRepMaxKg: main.latest,
        change1RmPct: change == null ? null : Math.round(change * 10) / 10,
        record: weekRecordIds.has(main.exerciseId),
      },
    ];
  });

  const prsHit = reviewRecords.map((r) => ({
    ...r,
    muscles: [...(groupsOf.get(r.exerciseId) ?? [])],
  }));

  return {
    window: p.window,
    timezone: p.timezone,
    bodyType: p.bodyType,
    from: p.windows.review.from,
    to: p.windows.review.to,
    strengthFrom: p.windows.strength.from,
    worked,
    strength,
    prsHit,
    totals: windowTotals(reviewSessions),
    asOf: p.asOf,
  };
}
