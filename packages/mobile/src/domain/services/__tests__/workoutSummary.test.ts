import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import {
  buildWorkoutSummary,
  muscleShare,
  recordSetIds,
  resolveMuscles,
  sessionMuscleInputs,
  summaryPages,
} from "../workoutSummary";

let seq = 0;
const set = (
  weightKg: number | null,
  reps: number | null,
  extra: Partial<ExerciseSet> = {},
): ExerciseSet => ({
  id: `s${++seq}`,
  sessionExerciseId: "x",
  setNumber: 1,
  weightKg,
  reps,
  rpe: null,
  durationSeconds: null,
  distanceMeters: null,
  isCompleted: true,
  completedAt: null,
  ...extra,
});

const session = (
  exercises: {
    exerciseId: string;
    name: string;
    sets: ExerciseSet[];
    skipped?: boolean;
    isSubstituted?: boolean;
    notes?: string | null;
  }[],
): WorkoutSession => ({
  id: "local-1",
  userId: "u1",
  workoutId: null,
  name: "Lower Body B",
  status: "completed",
  startedAt: "2026-10-23T10:00:00.000Z",
  completedAt: "2026-10-23T10:52:00.000Z",
  notes: null,
  exercises: exercises.map((e, i) => ({
    id: `se${i}`,
    sessionId: "local-1",
    exerciseId: e.exerciseId,
    exerciseName: e.name,
    sortOrder: i,
    supersetGroup: null,
    isSubstituted: e.isSubstituted ?? false,
    originalExerciseId: null,
    notes: e.notes ?? null,
    skipped: e.skipped,
    sets: e.sets,
  })),
});

describe("muscleShare", () => {
  it("credits primaries 1.0 and secondaries 0.5 per completed set", () => {
    const share = muscleShare([
      { primary: ["quadriceps"], secondary: ["glutes"], completedSets: 4 },
      { primary: ["hamstrings"], secondary: ["glutes"], completedSets: 2 },
    ]);
    expect(
      share.muscles.map((m) => [m.muscle, m.credit, m.share, m.sets]),
    ).toEqual([
      ["quadriceps", 4, 44, 4],
      ["glutes", 3, 33, 0],
      ["hamstrings", 2, 22, 2],
    ]);
  });

  it("shades by credit over the busiest muscle at the 0.75 / 0.5 / 0.25 bands", () => {
    const share = muscleShare([
      { primary: ["quadriceps"], secondary: [], completedSets: 8 },
      { primary: ["hamstrings"], secondary: [], completedSets: 6 }, // 0.75
      { primary: ["glutes"], secondary: [], completedSets: 4 }, // 0.5
      { primary: ["calves"], secondary: [], completedSets: 2 }, // 0.25
      { primary: ["adductors"], secondary: [], completedSets: 1 }, // 0.125
    ]);
    expect(
      Object.fromEntries(share.muscles.map((m) => [m.muscle, m.level])),
    ).toEqual({
      quadriceps: 4,
      hamstrings: 4,
      glutes: 3,
      calves: 2,
      adductors: 1,
    });
    // Just under each band drops a level.
    const under = muscleShare([
      { primary: ["chest"], secondary: [], completedSets: 100 },
      { primary: ["triceps"], secondary: [], completedSets: 74 },
      { primary: ["biceps"], secondary: [], completedSets: 49 },
      { primary: ["forearms"], secondary: [], completedSets: 24 },
    ]);
    expect(under.muscles.map((m) => m.level)).toEqual([4, 3, 2, 1]);
  });

  it("maps app muscles to library regions, taking the strongest level per region", () => {
    const share = muscleShare([
      { primary: ["back"], secondary: [], completedSets: 4 },
      { primary: ["lats"], secondary: [], completedSets: 1 },
      { primary: ["core"], secondary: [], completedSets: 2 },
      { primary: ["abductors"], secondary: ["glutes"], completedSets: 4 },
      { primary: ["hip_flexors"], secondary: [], completedSets: 4 },
    ]);
    const regions = Object.fromEntries(
      share.regions.map((r) => [r.slug, r.intensity]),
    );
    expect(regions).toEqual({
      "upper-back": 4,
      "lower-back": 4,
      abs: 3,
      obliques: 3,
      gluteal: 4,
    });
    // Hip flexors count in the legend but have no region.
    expect(share.muscles.some((m) => m.muscle === "hip_flexors")).toBe(true);
  });

  it("covers every mapped region in the slug map", () => {
    const share = muscleShare([
      {
        primary: [
          "chest",
          "shoulders",
          "biceps",
          "triceps",
          "forearms",
          "traps",
          "quadriceps",
          "hamstrings",
          "glutes",
          "adductors",
          "calves",
        ],
        secondary: [],
        completedSets: 1,
      },
    ]);
    expect(share.regions.map((r) => r.slug).sort()).toEqual(
      [
        "adductors",
        "biceps",
        "calves",
        "chest",
        "deltoids",
        "forearm",
        "gluteal",
        "hamstring",
        "quadriceps",
        "trapezius",
        "triceps",
      ].sort(),
    );
  });

  it("does not double-count a muscle listed as both primary and secondary, or twice", () => {
    const share = muscleShare([
      {
        primary: ["chest", "chest"],
        secondary: ["chest", "triceps", "triceps"],
        completedSets: 2,
      },
    ]);
    expect(share.muscles.map((m) => [m.muscle, m.credit])).toEqual([
      ["chest", 2],
      ["triceps", 1],
    ]);
  });

  it("labels the top three for screen readers", () => {
    const share = muscleShare([
      { primary: ["quadriceps"], secondary: [], completedSets: 9 },
      { primary: ["hamstrings"], secondary: [], completedSets: 6 },
      { primary: ["glutes"], secondary: [], completedSets: 5 },
      { primary: ["calves"], secondary: [], completedSets: 1 },
    ]);
    expect(share.top).toHaveLength(3);
    expect(share.accessibilityLabel).toBe(
      "Muscles worked: quads 43%, hamstrings 29%, glutes 24%",
    );
  });

  it("is empty when nothing was completed", () => {
    const share = muscleShare([
      { primary: ["chest"], secondary: ["triceps"], completedSets: 0 },
    ]);
    expect(share.muscles).toEqual([]);
    expect(share.regions).toEqual([]);
    expect(share.accessibilityLabel).toBe("No muscles worked");
  });
});

describe("sessionMuscleInputs", () => {
  it("counts sets with reps, skipping skipped, substituted and unknown exercises", () => {
    const s = session([
      {
        exerciseId: "squat",
        name: "Squat",
        sets: [
          set(60, 8),
          set(60, 0),
          set(60, null),
          set(60, 8, { isCompleted: false }),
        ],
      },
      { exerciseId: "rdl", name: "RDL", sets: [set(40, 10)], skipped: true },
      {
        exerciseId: "old",
        name: "Old",
        sets: [set(40, 10)],
        isSubstituted: true,
      },
      { exerciseId: "unknown", name: "Mystery", sets: [set(40, 10)] },
    ]);
    const inputs = sessionMuscleInputs(s, (id) =>
      id === "unknown"
        ? null
        : { primary: ["quadriceps"], secondary: ["glutes"] },
    );
    expect(inputs).toEqual([
      { primary: ["quadriceps"], secondary: ["glutes"], completedSets: 1 },
    ]);
  });
});

describe("buildWorkoutSummary", () => {
  it("totals completed sets and ranks weighted exercises by volume", () => {
    const s = session([
      {
        exerciseId: "squat",
        name: "Barbell Back Squat",
        sets: [set(60, 8), set(65, 7), set(70, 5, { isCompleted: false })],
        notes: "  felt strong ",
      },
      { exerciseId: "lunge", name: "Walking Lunge", sets: [set(null, 12)] },
      {
        exerciseId: "run",
        name: "Run",
        sets: [
          set(null, null, { durationSeconds: 600, distanceMeters: 2000 }),
          set(null, null, { durationSeconds: 300, distanceMeters: 1000 }),
        ],
      },
      { exerciseId: "rdl", name: "RDL", sets: [set(100, 10)] },
      {
        exerciseId: "none",
        name: "Not done",
        sets: [set(10, 10, { isCompleted: false })],
      },
      {
        exerciseId: "swap",
        name: "Swapped out",
        sets: [set(10, 10)],
        isSubstituted: true,
      },
    ]);
    const model = buildWorkoutSummary(s, 3120);
    expect(model).toMatchObject({
      name: "Lower Body B",
      durationSeconds: 3120,
      volumeKg: 60 * 8 + 65 * 7 + 1000,
      sets: 6,
      reps: 8 + 7 + 12 + 10,
      distanceMeters: 3000,
    });
    expect(model.exercises.map((e) => [e.name, e.setsLabel, e.notes])).toEqual([
      ["Barbell Back Squat", "2×8", "felt strong"],
      ["Walking Lunge", "1×12", null],
      ["Run", "2 sets", null],
      ["RDL", "1×10", null],
    ]);
    expect(model.volume.map((v) => v.name)).toEqual([
      "RDL",
      "Barbell Back Squat",
    ]);
    expect(model.exercises[0]!.sets[0]).toMatchObject({
      n: 1,
      volumeKg: 480,
      oneRepMaxKg: 60 * (1 + 8 / 30),
      isRecord: false,
    });
    expect(model.exercises[1]!.sets[0]!.oneRepMaxKg).toBeNull();
  });

  it("labels a single rep-less set in the singular", () => {
    const model = buildWorkoutSummary(
      session([
        {
          exerciseId: "run",
          name: "Run",
          sets: [set(null, null, { durationSeconds: 60 })],
        },
      ]),
      60,
    );
    expect(model.exercises[0]!.setsLabel).toBe("1 set");
    expect(model.volume).toEqual([]);
  });

  it("marks record sets", () => {
    const a = set(60, 8);
    const b = set(65, 7);
    const model = buildWorkoutSummary(
      session([{ exerciseId: "squat", name: "Squat", sets: [a, b] }]),
      60,
      [
        {
          exerciseId: "squat",
          exerciseName: "Squat",
          recordType: "max_weight",
          newValue: 65,
          previousValue: 62.5,
        },
      ],
    );
    expect(model.exercises[0]!.sets.map((r) => r.isRecord)).toEqual([
      false,
      true,
    ]);
  });
});

describe("recordSetIds", () => {
  const rec = (
    exerciseId: string,
    recordType: Parameters<typeof recordSetIds>[1][number]["recordType"],
    setId?: string,
  ) => ({
    exerciseId,
    exerciseName: exerciseId,
    recordType,
    newValue: 1,
    previousValue: null,
    setId,
  });

  it("uses the set the server names", () => {
    const a = set(100, 5);
    const b = set(60, 8);
    const s = session([{ exerciseId: "e", name: "E", sets: [a, b] }]);
    expect([...recordSetIds(s, [rec("e", "max_weight", b.id)])]).toEqual([
      b.id,
    ]);
  });

  it("falls back to the best set for each record type", () => {
    const heavy = set(100, 2);
    const many = set(40, 20);
    const big = set(85, 10);
    const long = set(null, null, { durationSeconds: 900, distanceMeters: 100 });
    const far = set(null, null, { durationSeconds: 100, distanceMeters: 5000 });
    const s = session([
      { exerciseId: "lift", name: "Lift", sets: [heavy, many, big] },
      { exerciseId: "run", name: "Run", sets: [long, far] },
      {
        exerciseId: "gone",
        name: "Gone",
        sets: [set(1, 1, { isCompleted: false })],
      },
    ]);
    const pick = (r: ReturnType<typeof rec>) => [...recordSetIds(s, [r])];
    expect(pick(rec("lift", "max_weight", "missing"))).toEqual([heavy.id]);
    expect(pick(rec("lift", "max_reps"))).toEqual([many.id]);
    expect(pick(rec("lift", "max_volume"))).toEqual([big.id]);
    expect(pick(rec("lift", "1rm"))).toEqual([big.id]);
    expect(pick(rec("run", "best_time"))).toEqual([long.id]);
    expect(pick(rec("run", "longest_distance"))).toEqual([far.id]);
    expect(pick(rec("run", "5rm"))).toEqual([long.id]);
    expect(pick(rec("gone", "max_weight"))).toEqual([]);
  });
});

describe("summaryPages", () => {
  const s = session([
    { exerciseId: "squat", name: "Squat", sets: [set(60, 8)] },
  ]);
  const model = buildWorkoutSummary(s, 60);
  const worked = muscleShare([
    { primary: ["quadriceps"], secondary: [], completedSets: 1 },
  ]);
  const none = muscleShare([]);
  const record = {
    exerciseId: "squat",
    exerciseName: "Squat",
    recordType: "max_weight" as const,
    newValue: 60,
    previousValue: null,
  };

  it("shows four pages for a solo workout without a record", () => {
    expect(
      summaryPages({ muscles: worked, model, records: [], together: false }),
    ).toEqual(["totals", "muscles", "exercises", "volume"]);
  });

  it("shows six pages for a Together workout with a record", () => {
    expect(
      summaryPages({
        muscles: worked,
        model,
        records: [record],
        together: true,
      }),
    ).toEqual([
      "totals",
      "muscles",
      "exercises",
      "volume",
      "records",
      "together",
    ]);
  });

  it("hides muscles and volume when they have no data", () => {
    const cardio = buildWorkoutSummary(
      session([
        {
          exerciseId: "run",
          name: "Run",
          sets: [set(null, null, { durationSeconds: 60 })],
        },
      ]),
      60,
    );
    expect(
      summaryPages({
        muscles: none,
        model: cardio,
        records: [],
        together: false,
      }),
    ).toEqual(["totals", "exercises"]);
  });
});

describe("resolveMuscles", () => {
  it("reads enum keys, catalogue UUIDs and display labels", () => {
    const names = new Map([
      ["uuid-chest", "Chest"],
      ["uuid-odd", "neck"],
    ]);
    expect(
      resolveMuscles(
        [
          "quadriceps",
          "uuid-chest",
          "uuid-hf",
          "uuid-quads",
          "uuid-odd",
          "uuid-none",
          "chest",
        ],
        [undefined as never, "Chest", "Hip Flexors", "Quads", "Neck"],
        names,
      ),
    ).toEqual(["quadriceps", "chest", "hip_flexors"]);
  });

  it("resolves without labels", () => {
    expect(
      resolveMuscles(["uuid-x"], undefined, new Map([["uuid-x", "lats"]])),
    ).toEqual(["lats"]);
  });

  it("reads the real catalogue's capitalised names without labels", () => {
    const names = new Map([
      ["u1", "Chest"],
      ["u2", "Hip Flexors"],
      ["u3", "Abs"],
      ["u4", "Lower Back"],
      ["u5", "Full Body"],
    ]);
    expect(resolveMuscles(["u1", "u2", "u3", "u4", "u5"], [], names)).toEqual([
      "chest",
      "hip_flexors",
      "core",
      "back",
    ]);
  });

  it("reads catalogue names in the labels, including Abs and Obliques", () => {
    expect(
      resolveMuscles(["u1", "u2"], ["Abs", "Obliques"], new Map()),
    ).toEqual(["core"]);
  });
});
