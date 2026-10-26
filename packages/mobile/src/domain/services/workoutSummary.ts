/**
 * Workout summary — the numbers behind the finish pages and Workout details
 * (PER-60 canvas row 3c, notes `n3b_cards` and `n3b_shade`).
 *
 * Pure: the summary container hands in the finished session, each
 * exercise's muscle groups and the server's records; the presenters only
 * render what comes out.
 */

import type { MuscleGroup } from "@/domain/models/exercise";
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from "@/domain/models/exercise";
import type { RecordType } from "@/domain/models/record";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import { estimateOneRepMax } from "./oneRepMax";

/** Body-map regions in `react-native-body-highlighter`. */
export type BodyMapSlug =
  | "abs"
  | "adductors"
  | "biceps"
  | "calves"
  | "chest"
  | "deltoids"
  | "forearm"
  | "gluteal"
  | "hamstring"
  | "lower-back"
  | "obliques"
  | "quadriceps"
  | "trapezius"
  | "triceps"
  | "upper-back";

/** `n3b_shade` §4. Hip flexors have no region; they count in the legend only. */
export const MUSCLE_SLUGS: Record<MuscleGroup, readonly BodyMapSlug[]> = {
  chest: ["chest"],
  back: ["upper-back", "lower-back"],
  lats: ["upper-back"],
  shoulders: ["deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  traps: ["trapezius"],
  core: ["abs", "obliques"],
  quadriceps: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal"],
  abductors: ["gluteal"],
  adductors: ["adductors"],
  calves: ["calves"],
  hip_flexors: [],
};

export type MuscleInput = {
  primary: readonly MuscleGroup[];
  secondary: readonly MuscleGroup[];
  /** Completed sets of this exercise: reps > 0 and the exercise not skipped. */
  completedSets: number;
};

export type MuscleShareRow = {
  muscle: MuscleGroup;
  label: string;
  credit: number;
  /** Rounded percentage of all credit. */
  share: number;
  /** Completed sets where this muscle was primary. */
  sets: number;
  /** 1–4 shade level; 0 is not worked. */
  level: 0 | 1 | 2 | 3 | 4;
};

export type MuscleShare = {
  /** Every worked muscle, most credit first. */
  muscles: MuscleShareRow[];
  /** The legend: the top three. */
  top: MuscleShareRow[];
  /** One entry per shaded region, at the highest level of its muscles. */
  regions: { slug: BodyMapSlug; intensity: 1 | 2 | 3 | 4 }[];
  /** "Muscles worked: quads 45%, hamstrings 30%, glutes 25%". */
  accessibilityLabel: string;
};

const shadeLevel = (ratio: number): MuscleShareRow["level"] =>
  ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0;

/**
 * `n3b_shade` §1–3: each completed set gives every primary muscle 1.0 and
 * every secondary 0.5. Share is credit over total credit; the shade level
 * is credit over the busiest muscle's credit.
 */
export function muscleShare(inputs: readonly MuscleInput[]): MuscleShare {
  const credit = new Map<MuscleGroup, number>();
  const sets = new Map<MuscleGroup, number>();
  for (const input of inputs) {
    if (input.completedSets <= 0) continue;
    for (const m of new Set(input.primary)) {
      credit.set(m, (credit.get(m) ?? 0) + input.completedSets);
      sets.set(m, (sets.get(m) ?? 0) + input.completedSets);
    }
    for (const m of new Set(input.secondary)) {
      if (input.primary.includes(m)) continue;
      credit.set(m, (credit.get(m) ?? 0) + input.completedSets * 0.5);
    }
  }
  const total = [...credit.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...credit.values());
  const muscles = [...credit.entries()]
    .map(([muscle, c]) => ({
      muscle,
      label: MUSCLE_GROUP_LABELS[muscle],
      credit: c,
      share: Math.round((c / total) * 100),
      sets: sets.get(muscle) ?? 0,
      level: shadeLevel(c / max),
    }))
    .sort((a, b) => b.credit - a.credit);
  const levels = new Map<BodyMapSlug, 1 | 2 | 3 | 4>();
  for (const row of muscles)
    for (const slug of MUSCLE_SLUGS[row.muscle])
      if (row.level > (levels.get(slug) ?? 0))
        levels.set(slug, row.level as 1 | 2 | 3 | 4);
  const top = muscles.slice(0, 3);
  return {
    muscles,
    top,
    regions: [...levels.entries()].map(([slug, intensity]) => ({
      slug,
      intensity,
    })),
    accessibilityLabel: top.length
      ? `Muscles worked: ${top
          .map((m) => `${m.label.toLowerCase()} ${m.share}%`)
          .join(", ")}`
      : "No muscles worked",
  };
}

export type SummaryRecord = {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  newValue: number;
  previousValue: number | null;
  /** The set that set the record, when the server names it. */
  setId?: string;
};

export type SummarySetRow = {
  id: string;
  n: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** Estimated one-rep max; null when it can't be estimated. */
  oneRepMaxKg: number | null;
  volumeKg: number;
  isRecord: boolean;
};

export type SummaryExerciseRow = {
  id: string;
  exerciseId: string;
  name: string;
  notes: string | null;
  sets: SummarySetRow[];
  volumeKg: number;
  /** "4×8", or "3 sets" when the sets have no reps. */
  setsLabel: string;
};

export type WorkoutSummaryModel = {
  name: string;
  startedAt: string;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
  reps: number;
  distanceMeters: number;
  /** Exercises with at least one completed set, in workout order. */
  exercises: SummaryExerciseRow[];
  /** Weighted exercises only, largest volume first. */
  volume: { id: string; name: string; volumeKg: number }[];
};

const isDone = (set: ExerciseSet) => set.isCompleted;

/** Which set each record came from: the named set, else the set with the best value. */
export function recordSetIds(
  session: WorkoutSession,
  records: readonly SummaryRecord[],
): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    const sets = session.exercises
      .filter((e) => e.exerciseId === record.exerciseId && !e.isSubstituted)
      .flatMap((e) => e.sets.filter(isDone));
    if (!sets.length) continue;
    const named = record.setId && sets.find((s) => s.id === record.setId);
    if (named) {
      ids.add(named.id);
      continue;
    }
    const metric = (s: ExerciseSet): number => {
      switch (record.recordType) {
        case "max_weight":
          return s.weightKg ?? 0;
        case "max_reps":
          return s.reps ?? 0;
        case "max_volume":
          return (s.weightKg ?? 0) * (s.reps ?? 0);
        case "best_time":
          return s.durationSeconds ?? 0;
        case "longest_distance":
          return s.distanceMeters ?? 0;
        default:
          return estimateOneRepMax(s.weightKg ?? 0, s.reps ?? 0) ?? 0;
      }
    };
    const best = sets.reduce((a, b) => (metric(b) > metric(a) ? b : a));
    ids.add(best.id);
  }
  return ids;
}

/** Totals, exercise rows and volume ranking for a finished session. */
export function buildWorkoutSummary(
  session: WorkoutSession,
  durationSeconds: number,
  records: readonly SummaryRecord[] = [],
): WorkoutSummaryModel {
  const recordIds = recordSetIds(session, records);
  let sets = 0;
  let reps = 0;
  let volumeKg = 0;
  let distanceMeters = 0;
  const exercises: SummaryExerciseRow[] = [];
  for (const exercise of session.exercises) {
    if (exercise.isSubstituted) continue;
    const done = exercise.sets.filter(isDone);
    if (!done.length) continue;
    let exerciseVolume = 0;
    const rows = done.map((set, i) => {
      const volume =
        set.weightKg != null && set.reps != null ? set.weightKg * set.reps : 0;
      exerciseVolume += volume;
      sets += 1;
      reps += set.reps ?? 0;
      distanceMeters += set.distanceMeters ?? 0;
      return {
        id: set.id,
        n: i + 1,
        weightKg: set.weightKg,
        reps: set.reps,
        durationSeconds: set.durationSeconds,
        distanceMeters: set.distanceMeters,
        oneRepMaxKg:
          set.weightKg != null && set.reps != null
            ? estimateOneRepMax(set.weightKg, set.reps)
            : null,
        volumeKg: volume,
        isRecord: recordIds.has(set.id),
      };
    });
    volumeKg += exerciseVolume;
    const firstReps = done.find((s) => s.reps != null)?.reps;
    exercises.push({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      name: exercise.exerciseName,
      notes: exercise.notes?.trim() ? exercise.notes.trim() : null,
      sets: rows,
      volumeKg: exerciseVolume,
      setsLabel:
        firstReps != null
          ? `${done.length}×${firstReps}`
          : `${done.length} ${done.length === 1 ? "set" : "sets"}`,
    });
  }
  return {
    name: session.name,
    startedAt: session.startedAt,
    durationSeconds,
    volumeKg,
    sets,
    reps,
    distanceMeters,
    exercises,
    volume: exercises
      .filter((e) => e.volumeKg > 0)
      .map((e) => ({ id: e.id, name: e.name, volumeKg: e.volumeKg }))
      .sort((a, b) => b.volumeKg - a.volumeKg),
  };
}

const isMuscle = (v: string): v is MuscleGroup =>
  (MUSCLE_GROUPS as readonly string[]).includes(v);
const BY_LABEL = new Map(
  Object.entries(MUSCLE_GROUP_LABELS).map(([k, label]) => [
    label.toLowerCase(),
    k,
  ]),
);

/**
 * An exercise's muscle groups as app muscles. Cached exercises carry the
 * backend's catalogue UUIDs; `names` maps them through the cached
 * `muscle_groups` reference list, and the display labels stand in when that
 * list hasn't been fetched ("Hip Flexors" → `hip_flexors`).
 */
export function resolveMuscles(
  values: readonly string[],
  labels: readonly string[] | undefined,
  names: ReadonlyMap<string, string>,
): MuscleGroup[] {
  const out = values.flatMap((value, i) => {
    const label = labels?.[i]?.trim().toLowerCase();
    const candidates = [
      value,
      names.get(value),
      label?.replace(/\s+/g, "_"),
      label && BY_LABEL.get(label),
    ];
    const hit = candidates.find((c): c is MuscleGroup => !!c && isMuscle(c));
    return hit ? [hit] : [];
  });
  return [...new Set(out)];
}

/** Muscle inputs for a session, from each exercise's muscle groups. */
export function sessionMuscleInputs(
  session: WorkoutSession,
  musclesOf: (exerciseId: string) => {
    primary: readonly MuscleGroup[];
    secondary: readonly MuscleGroup[];
  } | null,
): MuscleInput[] {
  return session.exercises
    .filter((e) => !e.isSubstituted && !e.skipped)
    .flatMap((e) => {
      const muscles = musclesOf(e.exerciseId);
      if (!muscles) return [];
      return [
        {
          ...muscles,
          completedSets: e.sets.filter(
            (s) => s.isCompleted && (s.reps ?? 0) > 0,
          ).length,
        },
      ];
    });
}

export type SummaryPage =
  | "totals"
  | "muscles"
  | "exercises"
  | "volume"
  | "records"
  | "together";

/** `n3b_cards`: up to six pages, each shown only when it has data. */
export function summaryPages(p: {
  muscles: MuscleShare;
  model: WorkoutSummaryModel;
  records: readonly SummaryRecord[];
  together: boolean;
}): SummaryPage[] {
  return [
    "totals",
    ...(p.muscles.muscles.length ? (["muscles"] as const) : []),
    "exercises",
    ...(p.model.volume.length ? (["volume"] as const) : []),
    ...(p.records.length ? (["records"] as const) : []),
    ...(p.together ? (["together"] as const) : []),
  ];
}
