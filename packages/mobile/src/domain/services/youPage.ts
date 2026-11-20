/**
 * You page (PER-141, canvas Y1–Y4) — the numbers behind Y1 (muscles, last
 * 7 days, top lifts), Y2 History and Y4 Recap, worked out on the phone from
 * finished workouts in the local training log. Pure: containers hand in
 * the cached sessions, records and muscle lookups.
 *
 * Offline-first (backend design H): everything here runs from the cache.
 * Ranges the phone can't cover (older months, 3 months, a new phone) go
 * through the BE-H1 seam in `application/queries/youRemote.ts`.
 */

import type { MuscleGroup } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";
import { calculateSummary } from "./sessionService";
import { estimateOneRepMax } from "./oneRepMax";
import {
  muscleCredit,
  type MuscleCreditRow,
  type MuscleDisplayGroup,
} from "./trainingMetrics/muscleCredit";
import {
  buildWorkoutSummary,
  sessionMuscleInputs,
  type BodyMapSlug,
} from "./workoutSummary";

export type MusclesOf = (exerciseId: string) => {
  primary: readonly MuscleGroup[];
  secondary: readonly MuscleGroup[];
} | null;

const pad = (n: number) => String(n).padStart(2, "0");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored date as a `Date`. A date-only "YYYY-MM-DD" (body-trend points,
 * habit days) is a local calendar day, so it reads as local midday: `new
 * Date("2026-06-10")` would be UTC midnight, the day before anywhere west of
 * Greenwich. Anything else is an instant.
 */
export function toLocalDate(value: string): Date {
  return DATE_ONLY.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
}

/** "2026-10-26" for the phone's local calendar day. */
export function dayKey(d: Date | string): string {
  if (typeof d === "string" && DATE_ONLY.test(d)) return d;
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight `days` days after `d` (negative goes back). */
export function startOfDayOffset(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** The last 7 days, today included: local midnight 6 days ago → now. */
export function lastSevenDays(now: Date): { from: Date; to: Date } {
  return { from: startOfDayOffset(now, -6), to: now };
}

/** Finished workouts that started inside [from, to], oldest first. */
export function sessionsBetween(
  sessions: readonly WorkoutSession[],
  from: Date,
  to: Date,
): WorkoutSession[] {
  const a = from.getTime();
  const b = to.getTime();
  return sessions
    .filter((s) => {
      const t = Date.parse(s.startedAt);
      return s.status === "completed" && t >= a && t <= b;
    })
    .sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt));
}

export type SessionTotals = {
  durationSeconds: number;
  volumeKg: number;
  sets: number;
};

/** One workout's length, volume and sets, counted as the summary counts them. */
export function sessionTotals(session: WorkoutSession): SessionTotals {
  const durationSeconds =
    session.retrospectiveDurationSeconds ?? calculateSummary(session).duration;
  const model = buildWorkoutSummary(session, durationSeconds);
  return { durationSeconds, volumeKg: model.volumeKg, sets: model.sets };
}

export type TrainingTotals = SessionTotals & { workouts: number };

/** Workouts · Volume · Time for a window (the Y1b strip, Recap's first page). */
export function trainingTotals(
  sessions: readonly WorkoutSession[],
): TrainingTotals {
  return sessions.reduce<TrainingTotals>(
    (acc, s) => {
      const t = sessionTotals(s);
      return {
        workouts: acc.workouts + 1,
        durationSeconds: acc.durationSeconds + t.durationSeconds,
        volumeKg: acc.volumeKg + t.volumeKg,
        sets: acc.sets + t.sets,
      };
    },
    { workouts: 0, durationSeconds: 0, volumeKg: 0, sets: 0 },
  );
}

/** Muscle credit across every workout in the window. */
export function musclesForSessions(
  sessions: readonly WorkoutSession[],
  musclesOf: MusclesOf,
): MuscleCreditRow[] {
  return muscleCredit(
    sessions.flatMap((s) => sessionMuscleInputs(s, musclesOf)),
  );
}

/** Display group → body-map regions in `react-native-body-highlighter`. */
export const GROUP_SLUGS: Record<MuscleDisplayGroup, readonly BodyMapSlug[]> = {
  back: ["upper-back", "lower-back", "trapezius"],
  quads: ["quadriceps"],
  chest: ["chest"],
  shoulders: ["deltoids"],
  glutes: ["gluteal", "adductors"],
  arms: ["biceps", "triceps"],
  hamstrings: ["hamstring"],
  core: ["abs", "obliques"],
  calves: ["calves"],
  forearms: ["forearm"],
};

export type BodyMapShading = {
  regions: { slug: BodyMapSlug; intensity: 1 | 2 | 3 | 4 }[];
  accessibilityLabel: string;
};

/**
 * Body-map shading from credit rows. `level` picks the shade: on Y1 it's the
 * weekly-guide ratio. `relative` instead shades against the busiest group,
 * for a single day (History) or a long window (Recap) where a weekly guide
 * doesn't apply.
 */
export function bodyMapShading(
  rows: readonly MuscleCreditRow[],
  label: string,
  relative = false,
): BodyMapShading {
  const max = Math.max(0, ...rows.map((r) => r.credit));
  const regions: BodyMapShading["regions"] = [];
  for (const r of rows) {
    if (r.credit <= 0) continue;
    const level = relative ? relativeLevel(r.credit / max) : r.level;
    if (level === 0) continue;
    for (const slug of GROUP_SLUGS[r.group])
      regions.push({ slug, intensity: level });
  }
  return { regions, accessibilityLabel: label };
}

function relativeLevel(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return ratio > 0 ? 1 : 0;
}

/** "Chest, back, shoulders": worked groups, most credit first. */
export function workedList(rows: readonly MuscleCreditRow[]): string {
  const worked = rows
    .filter((r) => r.credit > 0)
    .sort((a, b) => b.credit - a.credit)
    .map((r) => r.label.toLowerCase());
  return sentenceList(worked);
}

/** ["hamstrings", "calves"] → "Hamstrings, calves". */
export function sentenceList(items: readonly string[]): string {
  const text = items.join(", ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

const LOWER = new Set<MuscleDisplayGroup>([
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
]);
const UPPER = new Set<MuscleDisplayGroup>([
  "chest",
  "back",
  "shoulders",
  "arms",
  "forearms",
  "core",
]);

/** Which day sorts a set of muscles: "lower", "upper", or neither. */
export function dayThatSorts(
  groups: readonly MuscleDisplayGroup[],
): "lower" | "upper" | null {
  if (!groups.length) return null;
  if (groups.every((g) => LOWER.has(g))) return "lower";
  if (groups.every((g) => UPPER.has(g))) return "upper";
  return null;
}

export type TopLift = {
  exerciseId: string;
  name: string;
  weightKg: number;
  reps: number;
  /** When the best set was done. */
  startedAt: string;
  oneRepMaxKg: number;
  /** A personal record for this exercise fell inside the window. */
  isRecord: boolean;
};

/**
 * Top lifts by estimated 1RM: each exercise's best completed set, best
 * first. Sets the 1RM formula can't estimate (no weight, 11+ reps) don't
 * rank. A lift is a record (gold) when the records cache has one for that
 * exercise achieved at or after `since`.
 */
export function topLifts(
  sessions: readonly WorkoutSession[],
  records: readonly PersonalRecord[],
  since: Date,
  limit = 5,
): TopLift[] {
  const best = new Map<string, TopLift>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.isSubstituted || e.skipped) continue;
      for (const set of e.sets) {
        if (!set.isCompleted || set.weightKg == null || set.reps == null)
          continue;
        const orm = estimateOneRepMax(set.weightKg, set.reps);
        if (orm == null) continue;
        const prev = best.get(e.exerciseId);
        if (prev && prev.oneRepMaxKg >= orm) continue;
        best.set(e.exerciseId, {
          exerciseId: e.exerciseId,
          name: e.exerciseName,
          weightKg: set.weightKg,
          reps: set.reps,
          startedAt: s.startedAt,
          oneRepMaxKg: orm,
          isRecord: false,
        });
      }
    }
  }
  const recordIds = new Set(
    records
      .filter((r) => Date.parse(r.achievedAt) >= since.getTime())
      .map((r) => r.exerciseId),
  );
  return [...best.values()]
    .map((l) => ({ ...l, isRecord: recordIds.has(l.exerciseId) }))
    .sort((a, b) => b.oneRepMaxKg - a.oneRepMaxKg)
    .slice(0, limit);
}

export type CalendarCell = {
  /** Day of month, or null for a padding cell outside the month. */
  day: number | null;
  key: string | null;
  logged: boolean;
  /** After today: shown faint and can't be picked. */
  future: boolean;
};

/**
 * The Y2 month grid, Monday first, padded to whole weeks. `logged` holds
 * the day keys with anything logged (workout, food, steps, weight, habits).
 */
export function monthCells(
  year: number,
  month: number,
  logged: ReadonlySet<string>,
  today: Date,
): CalendarCell[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const todayKey = dayKey(today);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++)
    cells.push({ day: null, key: null, logged: false, future: false });
  for (let d = 1; d <= days; d++) {
    const key = dayKey(new Date(year, month, d));
    cells.push({
      day: d,
      key,
      logged: logged.has(key),
      future: key > todayKey,
    });
  }
  while (cells.length % 7)
    cells.push({ day: null, key: null, logged: false, future: false });
  return cells;
}

export type HistoryWorkout = {
  id: string;
  name: string;
  startedAt: string;
  totals: SessionTotals;
  records: number;
};

export type HistoryDayModel = {
  key: string;
  workouts: HistoryWorkout[];
  muscles: MuscleCreditRow[];
  totals: TrainingTotals;
};

/** One History day: its workouts, muscles across all of them, and totals. */
export function historyDay(
  key: string,
  sessions: readonly WorkoutSession[],
  records: readonly PersonalRecord[],
  musclesOf: MusclesOf,
): HistoryDayModel {
  const day = sessions
    .filter((s) => s.status === "completed" && dayKey(s.startedAt) === key)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return {
    key,
    workouts: day.map((s) => ({
      id: s.id,
      name: s.name,
      startedAt: s.startedAt,
      totals: sessionTotals(s),
      records: records.filter((r) => r.sessionId === s.id).length,
    })),
    muscles: musclesForSessions(day, musclesOf),
    totals: trainingTotals(day),
  };
}

export type RecapPeriod = "week" | "month" | "3months";

/** The window a recap covers, ending now. */
export function recapWindow(
  period: RecapPeriod,
  now: Date,
): { from: Date; to: Date } {
  if (period === "week") {
    const monday = startOfDayOffset(now, -((now.getDay() + 6) % 7));
    return { from: monday, to: now };
  }
  if (period === "month")
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now };
}

/** The window just before, of the same kind (for "1 more than last week"). */
export function previousRecapWindow(
  period: RecapPeriod,
  now: Date,
): { from: Date; to: Date } {
  const cur = recapWindow(period, now);
  if (period === "week")
    return {
      from: startOfDayOffset(cur.from, -7),
      to: new Date(cur.from.getTime() - 1),
    };
  const months = period === "month" ? 1 : 3;
  return {
    from: new Date(cur.from.getFullYear(), cur.from.getMonth() - months, 1),
    to: new Date(cur.from.getTime() - 1),
  };
}

export type RecapModel = {
  period: RecapPeriod;
  totals: TrainingTotals;
  previous: TrainingTotals;
  muscles: MuscleCreditRow[];
  lifts: TopLift[];
  /** Weighted exercises by volume, largest first. */
  volume: { exerciseId: string; name: string; volumeKg: number }[];
  records: PersonalRecord[];
  together: { sessions: number; names: string[] };
};

/** Every page of a recap, from the sessions and records the phone holds. */
export function buildRecap(p: {
  period: RecapPeriod;
  now: Date;
  sessions: readonly WorkoutSession[];
  records: readonly PersonalRecord[];
  musclesOf: MusclesOf;
  /** Partner names per Together session id, when the phone knows them. */
  partners?: ReadonlyMap<string, readonly string[]>;
}): RecapModel {
  const w = recapWindow(p.period, p.now);
  const prev = previousRecapWindow(p.period, p.now);
  const inWindow = sessionsBetween(p.sessions, w.from, w.to);
  const volume = new Map<string, { name: string; volumeKg: number }>();
  for (const s of inWindow)
    for (const e of buildWorkoutSummary(s, 0).exercises) {
      if (e.volumeKg <= 0) continue;
      const v = volume.get(e.exerciseId) ?? { name: e.name, volumeKg: 0 };
      v.volumeKg += e.volumeKg;
      volume.set(e.exerciseId, v);
    }
  const together = inWindow.filter((s) => s.together);
  const names = new Set<string>();
  for (const s of together)
    for (const n of p.partners?.get(s.id) ?? []) names.add(n);
  return {
    period: p.period,
    totals: trainingTotals(inWindow),
    previous: trainingTotals(sessionsBetween(p.sessions, prev.from, prev.to)),
    muscles: musclesForSessions(inWindow, p.musclesOf),
    lifts: topLifts(inWindow, p.records, w.from),
    volume: [...volume.entries()]
      .map(([exerciseId, v]) => ({ exerciseId, ...v }))
      .sort((a, b) => b.volumeKg - a.volumeKg),
    records: p.records
      .filter((r) => {
        const t = Date.parse(r.achievedAt);
        return t >= w.from.getTime() && t <= w.to.getTime();
      })
      .sort((a, b) => Date.parse(b.achievedAt) - Date.parse(a.achievedAt)),
    together: { sessions: together.length, names: [...names] },
  };
}
