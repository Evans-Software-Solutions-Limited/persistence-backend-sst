/**
 * Shared phone/server fixtures (backend design H, test 5): one seeded week
 * that the phone's You page pipeline (packages/mobile) and the server's
 * routes (microservices/core) must both turn into `SEEDED_WEEK_EXPECTED`.
 *
 * Times are UTC in November, so Europe/London local days equal UTC days.
 * Muscles are app keys; the server suite seeds them as catalogue names via
 * `CATALOGUE_NAME_FOR_KEY`.
 */
import type { TrainingSession } from "./session";

export const SEEDED_WEEK_TIMEZONE = "Europe/London";

/** "Now" for the fixture: Sunday evening, so the last 7 days hold it all. */
export const SEEDED_WEEK_NOW = "2026-11-22T20:00:00.000Z";

export const SEEDED_WEEK_EXERCISES = {
  bench: "00000000-0000-4000-8000-0000000000b1",
  row: "00000000-0000-4000-8000-0000000000b2",
  curl: "00000000-0000-4000-8000-0000000000b3",
  fly: "00000000-0000-4000-8000-0000000000b4",
  squat: "00000000-0000-4000-8000-0000000000c1",
  rdl: "00000000-0000-4000-8000-0000000000c2",
  calfRaise: "00000000-0000-4000-8000-0000000000c3",
  plank: "00000000-0000-4000-8000-0000000000d1",
  legRaise: "00000000-0000-4000-8000-0000000000d2",
  burpee: "00000000-0000-4000-8000-0000000000d3",
} as const;

const E = SEEDED_WEEK_EXERCISES;

const sets = (
  prefix: string,
  rows: readonly [
    reps: number | null,
    weightKg: number | null,
    done?: boolean,
  ][],
) =>
  rows.map(([reps, weightKg, done = true], i) => ({
    id: `${prefix}-${i + 1}`,
    isCompleted: done,
    reps,
    weightKg,
  }));

export const SEEDED_WEEK_SESSIONS: readonly TrainingSession[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    name: "Upper A",
    startedAt: "2026-11-16T07:10:00.000Z",
    completedAt: "2026-11-16T08:05:00.000Z",
    durationSeconds: null,
    exercises: [
      {
        exerciseId: E.bench,
        name: "Bench press",
        isSubstituted: false,
        primary: ["chest"],
        secondary: ["triceps", "shoulders"],
        // The fifth set was never finished.
        sets: sets("bench", [
          [8, 80],
          [8, 80],
          [6, 85],
          [6, 85],
          [6, 85, false],
        ]),
      },
      {
        exerciseId: E.row,
        name: "Barbell row",
        isSubstituted: false,
        primary: ["back", "lats"],
        secondary: ["biceps"],
        sets: sets("row", [
          [10, 70],
          [10, 70],
          [10, 70],
          [10, 70],
        ]),
      },
      {
        // Swapped for the cable fly below: its sets never count.
        exerciseId: E.fly,
        name: "Machine fly",
        isSubstituted: true,
        primary: ["chest"],
        secondary: [],
        sets: sets("fly", [[12, 40]]),
      },
      {
        exerciseId: E.curl,
        name: "Biceps curl",
        isSubstituted: false,
        primary: ["biceps"],
        secondary: ["forearms"],
        sets: sets("curl", [
          [12, 15],
          [12, 15],
          [10, 17.5],
        ]),
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    name: "Lower",
    startedAt: "2026-11-18T07:00:00.000Z",
    completedAt: "2026-11-18T08:10:00.000Z",
    // Logged afterwards with its own length.
    durationSeconds: 3600,
    exercises: [
      {
        exerciseId: E.squat,
        name: "Back squat",
        isSubstituted: false,
        primary: ["quadriceps"],
        secondary: ["glutes", "hamstrings"],
        // A ticked set with 0 reps counts as a set but earns no credit.
        sets: sets("squat", [
          [5, 100],
          [5, 100],
          [5, 105],
          [5, 105],
          [0, 105],
        ]),
      },
      {
        exerciseId: E.rdl,
        name: "Romanian deadlift",
        isSubstituted: false,
        primary: ["hamstrings", "glutes"],
        secondary: ["back"],
        sets: sets("rdl", [
          [8, 90],
          [8, 90],
          [8, 90],
        ]),
      },
      {
        exerciseId: E.calfRaise,
        name: "Calf raise",
        isSubstituted: false,
        primary: ["calves"],
        secondary: [],
        // 15 reps: too many to estimate a 1RM.
        sets: sets("calf", [
          [15, 40],
          [15, 40],
          [15, 40],
          [15, 40],
        ]),
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    name: "Core finisher",
    startedAt: "2026-11-18T18:30:00.000Z",
    completedAt: "2026-11-18T18:50:00.000Z",
    durationSeconds: null,
    exercises: [
      {
        exerciseId: E.plank,
        name: "Plank",
        isSubstituted: false,
        primary: ["core"],
        secondary: [],
        // Timed holds: no reps, so no credit, but they are sets.
        sets: sets("plank", [
          [null, null],
          [null, null],
        ]),
      },
      {
        exerciseId: E.legRaise,
        name: "Hanging leg raise",
        isSubstituted: false,
        primary: ["hip_flexors"],
        secondary: ["core"],
        sets: sets("legraise", [
          [12, null],
          [12, null],
          [10, null],
        ]),
      },
      {
        // "Full Body" has no app muscle: sets and reps, but no credit.
        exerciseId: E.burpee,
        name: "Burpee",
        isSubstituted: false,
        primary: [],
        secondary: [],
        sets: sets("burpee", [[10, null]]),
      },
    ],
  },
];

/** Exercises with a personal record inside the week. */
export const SEEDED_WEEK_RECORD_EXERCISE_IDS: readonly string[] = [E.squat];

const r = (
  muscle: string,
  label: string,
  credit: number,
  hardSets: number,
  weeklyGuide: number,
  share: number,
) => {
  const ratio = Math.min(1, credit / weeklyGuide);
  const level =
    ratio >= 1 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0;
  return { muscle, label, credit, hardSets, weeklyGuide, ratio, share, level };
};

/**
 * What both sides must produce for the last 7 days ending
 * `SEEDED_WEEK_NOW`. Credit by hand:
 * - Chest 4 (bench). Arms: bench triceps 0.5×4 + row biceps 0.5×4 + curl
 *   1×3 = 7, hard sets 3. Shoulders 0.5×4 = 2. Back: row 1×4 + RDL 0.5×3
 *   = 5.5, hard sets 4. Forearms 0.5×3 = 1.5.
 * - Quads 4 (the 0-rep set earns nothing). Glutes: squat 0.5×4 + RDL 1×3 =
 *   5, hard sets 3. Hamstrings the same. Calves 4.
 * - Volume: Upper A 5,635 kg, Lower 6,610 kg, core 0 → 12,245 kg over
 *   11 + 12 + 6 = 29 completed sets; 55 + 60 + 20 minutes.
 * - Core: leg raise 1×3 (hip flexors primary beats core secondary in the
 *   same group); the plank has no reps. Total credit 41.
 */
export const SEEDED_WEEK_EXPECTED = {
  totals: { workouts: 3, durationSeconds: 8100, volumeKg: 12245, sets: 29 },
  muscles: [
    r("back", "Back", 5.5, 4, 10, 13),
    r("quads", "Quads", 4, 4, 10, 10),
    r("chest", "Chest", 4, 4, 10, 10),
    r("shoulders", "Shoulders", 2, 0, 10, 5),
    r("glutes", "Glutes", 5, 3, 10, 12),
    r("arms", "Arms", 7, 3, 10, 17),
    r("hamstrings", "Hamstrings", 5, 3, 10, 12),
    r("core", "Core", 3, 3, 6, 7),
    r("calves", "Calves", 4, 4, 6, 10),
    r("forearms", "Forearms", 1.5, 0, 6, 4),
  ],
  trainNext: [
    "shoulders",
    "forearms",
    "quads",
    "chest",
    "glutes",
    "hamstrings",
    "core",
    "back",
    "calves",
    "arms",
  ],
  rest: [] as string[],
  topLifts: [
    { exerciseId: E.squat, oneRepMaxKg: 105 * (1 + 5 / 30), isRecord: true },
    { exerciseId: E.rdl, oneRepMaxKg: 90 * (1 + 8 / 30), isRecord: false },
    { exerciseId: E.bench, oneRepMaxKg: 85 * (1 + 6 / 30), isRecord: false },
    { exerciseId: E.row, oneRepMaxKg: 70 * (1 + 10 / 30), isRecord: false },
    { exerciseId: E.curl, oneRepMaxKg: 17.5 * (1 + 10 / 30), isRecord: false },
  ],
} as const;
