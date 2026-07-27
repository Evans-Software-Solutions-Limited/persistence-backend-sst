/**
 * Phase E · T-E2.1 — the fixture set: 20 workouts × 4 equipment contexts.
 *
 * Every `exercise` string must resolve to a row in the seeded catalogue
 * (`packages/seed/data/exercises.json`); `run.ts` hard-fails on a miss rather
 * than skipping the row, so a fixture can never silently shrink.
 *
 * Workouts 1-3 are the three REAL seeded workouts from
 * `packages/seed/data/workouts.json`, verbatim (sets/reps/rest included) —
 * they are what a freshly seeded account actually owns. Workouts 4-20 are
 * ordinary training templates (PPL, upper/lower, 5×5, glute/arm/core days,
 * conditioning) composed only from names that exist in that catalogue, with
 * realistic targets and two supersetted pairs so target-preservation is
 * exercised.
 */

export type FixtureRow = {
  exercise: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  rest: number;
  supersetGroup?: string;
};

export type FixtureWorkout = {
  key: string;
  name: string;
  source: "seeded" | "authored";
  rows: FixtureRow[];
};

const r = (
  exercise: string,
  sets: number,
  repsMin: number,
  repsMax: number,
  rest = 90,
  supersetGroup?: string,
): FixtureRow => ({ exercise, sets, repsMin, repsMax, rest, supersetGroup });

export const WORKOUTS: FixtureWorkout[] = [
  {
    key: "w01-seeded-upper",
    name: "Upper Body",
    source: "seeded",
    rows: [
      r("Machine Chest Press", 3, 8, 10, 60),
      r("Machine Lateral Raise", 3, 8, 10, 60),
      r("Machine Seated Row", 3, 8, 10, 60),
      r("Machine Bicep Curl", 3, 10, 12, 60),
      r("Machine Triceps Extension", 3, 10, 12, 60),
    ],
  },
  {
    key: "w02-seeded-lower",
    name: "Lower Body",
    source: "seeded",
    rows: [
      r("Leg Extension", 3, 8, 10, 60),
      r("Leg Curl", 3, 8, 10, 60),
      r("Standing Calf Raise", 3, 8, 10, 60),
      r("Leg Press", 3, 8, 10, 60),
    ],
  },
  {
    key: "w03-seeded-fullbody",
    name: "Full Body Starter Workout",
    source: "seeded",
    rows: [
      r("Leg Press", 3, 8, 10, 60),
      r("Machine Chest Press", 3, 8, 10, 60),
      r("Walking Lunges", 3, 20, 20, 60),
      r("Machine Seated Shoulder Press", 3, 8, 10, 60),
      r("Lat Machine Wide Grip Pulldown", 3, 10, 12, 60),
      r("Ab Crunch", 2, 15, 20, 60),
      r("Plank", 2, 30, 30, 60),
    ],
  },
  {
    key: "w04-push-hypertrophy",
    name: "Push (Hypertrophy)",
    source: "authored",
    rows: [
      r("Barbell Bench Press", 4, 6, 8, 120),
      r("Seated Dumbbell Shoulder Press", 3, 8, 10, 90),
      r("Incline Dumbbell Bench Press", 3, 10, 12, 90),
      r("Cable Pec Fly", 3, 12, 15, 60),
      r("Triceps Pushdown", 3, 12, 15, 60, "A"),
      r("Dumbbell Lateral Raise", 3, 12, 15, 60, "A"),
    ],
  },
  {
    key: "w05-pull-hypertrophy",
    name: "Pull (Hypertrophy)",
    source: "authored",
    rows: [
      r("Barbell Bent-Over Row", 4, 6, 8, 120),
      r("Lat Pull-Down", 3, 8, 10, 90),
      r("Seated Cable Rows", 3, 10, 12, 90),
      r("Seated Face Pull", 3, 15, 15, 60),
      r("Barbell Curl", 3, 10, 12, 60, "A"),
      r("Hammer Curl", 3, 12, 15, 60, "A"),
    ],
  },
  {
    key: "w06-legs-hypertrophy",
    name: "Legs (Hypertrophy)",
    source: "authored",
    rows: [
      r("Barbell Back Squat", 4, 6, 8, 150),
      r("Romanian Deadlift", 3, 8, 10, 120),
      r("Leg Press", 3, 10, 12, 90),
      r("Leg Curl", 3, 12, 15, 60),
      r("Standing Calf Raise", 4, 12, 15, 45),
    ],
  },
  {
    key: "w07-strength-5x5-a",
    name: "Strength 5×5 — A",
    source: "authored",
    rows: [
      r("Barbell Back Squat", 5, 5, 5, 180),
      r("Barbell Bench Press", 5, 5, 5, 180),
      r("Barbell Bent-Over Row", 5, 5, 5, 150),
    ],
  },
  {
    key: "w08-strength-5x5-b",
    name: "Strength 5×5 — B",
    source: "authored",
    rows: [
      r("Barbell Back Squat", 5, 5, 5, 180),
      r("Barbell Shoulder Press", 5, 5, 5, 180),
      r("Barbell Deadlift", 1, 5, 5, 240),
    ],
  },
  {
    key: "w09-upper-strength",
    name: "Upper (Strength)",
    source: "authored",
    rows: [
      r("Barbell Bench Press", 4, 4, 6, 180),
      r("Pull-up", 4, 6, 8, 120),
      r("Barbell Shoulder Press", 3, 6, 8, 120),
      r("One-Arm Dumbbell Row", 3, 8, 10, 90),
      r("EZ-Bar Skullcrusher", 3, 10, 12, 60),
    ],
  },
  {
    key: "w10-lower-strength",
    name: "Lower (Strength)",
    source: "authored",
    rows: [
      r("Barbell Deadlift", 4, 4, 6, 210),
      r("Barbell Front Squat", 3, 6, 8, 150),
      r("Dumbbell Bulgarian Split Squat", 3, 8, 10, 90),
      r("Barbell Good Morning", 3, 10, 12, 90),
      r("Hanging Leg Raise", 3, 10, 12, 60),
    ],
  },
  {
    key: "w11-fullbody-dumbbell",
    name: "Full Body (Dumbbell)",
    source: "authored",
    rows: [
      r("Goblet Squat", 3, 10, 12, 90),
      r("Dumbbell Bench Press", 3, 10, 12, 90),
      r("One-Arm Dumbbell Row", 3, 10, 12, 90),
      r("Dumbbell Lunges", 3, 12, 12, 60),
      r("Dumbbell Bicep Curl", 3, 12, 15, 45),
    ],
  },
  {
    key: "w12-glutes",
    name: "Glutes & Hamstrings",
    source: "authored",
    rows: [
      r("Barbell Hip Thrust", 4, 8, 10, 120),
      r("Romanian Deadlift", 3, 8, 10, 120),
      r("Reverse Lunge", 3, 10, 12, 90),
      r("Leg Curl", 3, 12, 15, 60),
      r("Glute Bridge", 3, 15, 20, 45),
    ],
  },
  {
    key: "w13-arms",
    name: "Arms",
    source: "authored",
    rows: [
      r("Barbell Curl", 4, 8, 10, 75, "A"),
      r("Triceps Pushdown", 4, 10, 12, 75, "A"),
      r("Hammer Curl", 3, 12, 15, 60, "B"),
      r("Cable Overhead Triceps Extension", 3, 12, 15, 60, "B"),
    ],
  },
  {
    key: "w14-core",
    name: "Core",
    source: "authored",
    rows: [
      r("Hanging Leg Raise", 3, 10, 12, 60),
      r("Russian Twist", 3, 20, 20, 45),
      r("Plank", 3, 45, 60, 45),
      r("Side Plank", 3, 30, 45, 45),
      r("Dead Bug Reach", 3, 10, 12, 45),
    ],
  },
  {
    key: "w15-conditioning",
    name: "Conditioning Circuit",
    source: "authored",
    rows: [
      r("Kettlebell Swing", 4, 15, 20, 60),
      r("Box Jump", 4, 8, 10, 60),
      r("Burpee", 4, 10, 12, 60),
      r("Mountain Climber", 4, 20, 30, 60),
    ],
  },
  {
    key: "w16-chest-back-superset",
    name: "Chest & Back (Supersets)",
    source: "authored",
    rows: [
      r("Barbell Bench Press", 4, 8, 10, 90, "A"),
      r("Barbell Bent-Over Row", 4, 8, 10, 90, "A"),
      r("Incline Dumbbell Bench Press", 3, 10, 12, 75, "B"),
      r("Lat Pull-Down", 3, 10, 12, 75, "B"),
      r("Dumbbell Flyes", 3, 12, 15, 60),
    ],
  },
  {
    key: "w17-shoulders",
    name: "Shoulders & Traps",
    source: "authored",
    rows: [
      r("Barbell Shoulder Press", 4, 6, 8, 120),
      r("Dumbbell Lateral Raise", 4, 12, 15, 60),
      r("Seated Face Pull", 3, 15, 20, 60),
      r("Dumbbell Shrug", 3, 12, 15, 60),
    ],
  },
  {
    key: "w18-beginner-fullbody",
    name: "Beginner Full Body",
    source: "authored",
    rows: [
      r("Goblet Squat", 3, 10, 12, 90),
      r("Push-up", 3, 8, 12, 60),
      r("Seated Cable Rows", 3, 10, 12, 90),
      r("Glute Bridge", 3, 12, 15, 60),
      r("Plank", 3, 30, 45, 45),
    ],
  },
  {
    key: "w19-athletic-power",
    name: "Athletic Power",
    source: "authored",
    rows: [
      r("Barbell Deadlift", 4, 3, 5, 210),
      r("Box Jump", 4, 5, 5, 120),
      r("Barbell Front Squat", 3, 5, 5, 150),
      r("Medicine Ball Slam", 3, 10, 12, 90),
      r("Dumbbell Farmer's Walk", 3, 30, 40, 90),
    ],
  },
  {
    key: "w20-cardio-strength",
    name: "Cardio + Strength Mix",
    source: "authored",
    rows: [
      r("Treadmill Running", 1, 600, 600, 0),
      r("Barbell Back Squat", 3, 8, 10, 120),
      r("Dumbbell Bench Press", 3, 10, 12, 90),
      r("Seated Cable Rows", 3, 10, 12, 90),
      r("Russian Twist", 3, 20, 20, 45),
    ],
  },
];

export type FixtureContext = {
  key: string;
  label: string;
  equipment: string[];
};

/**
 * The four canonical contexts from `requirements.md` § Eval spike.
 * `Bodyweight` and `Yoga Mat` are present in every context because the
 * catalogue attaches them to most floor work — omitting them would make the
 * contexts artificially hostile rather than realistic. `full_gym` is the whole
 * 28-row `equipment_types` catalogue (the control arm: almost everything is
 * KEPT, which is itself worth measuring).
 */
export const CONTEXTS: FixtureContext[] = [
  {
    key: "full_gym",
    label: "Full commercial gym (all 28 equipment types)",
    equipment: [
      "Barbell",
      "Dumbbells",
      "Kettlebell",
      "Resistance Bands",
      "Pull-up Bar",
      "Bench",
      "Cable Machine",
      "Smith Machine",
      "Squat Rack",
      "Leg Press Machine",
      "Leg Curl Machine",
      "Leg Extension Machine",
      "Lat Pulldown Machine",
      "Rowing Machine",
      "Treadmill",
      "Exercise Bike",
      "Elliptical",
      "Medicine Ball",
      "Foam Roller",
      "Yoga Mat",
      "Box / Step",
      "TRX / Suspension Trainer",
      "EZ Bar",
      "Dip Station",
      "Bodyweight",
      "Battle Ropes",
      "Sled",
      "Ab Wheel",
    ],
  },
  {
    key: "dumbbells_bench",
    label: "Home garage — dumbbells + adjustable bench",
    equipment: ["Dumbbells", "Bench", "Bodyweight", "Yoga Mat"],
  },
  {
    key: "bands_only",
    label: "Travel — resistance bands only",
    equipment: ["Resistance Bands", "Bodyweight", "Yoga Mat"],
  },
  {
    key: "hotel_gym",
    label: "Hotel gym — light dumbbells, bench, cable stack, treadmill, bike",
    equipment: [
      "Dumbbells",
      "Bench",
      "Cable Machine",
      "Treadmill",
      "Exercise Bike",
      "Bodyweight",
      "Yoga Mat",
    ],
  },
];
