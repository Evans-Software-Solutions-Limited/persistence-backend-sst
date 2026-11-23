/**
 * Muscle credit — the one shared weekly-volume calculation behind the You
 * page muscle map (Y1), History's "Muscles worked" (Y2), Recap's muscle
 * balance (Y4) and the coach's Worked map (C3 / C3.1). Backend design H,
 * canvas note `n3b_shade`, You note `yn1`. The phone (PER-141) and the
 * server (PER-113) both import it from here, so they always agree.
 *
 * Rules:
 * - For each completed set (reps > 0, exercise not skipped), each primary
 *   muscle gets 1.0 credit and each secondary muscle 0.5.
 * - Muscles are summed into the ten groups the You page shows (Recap's
 *   muscle-balance list). Within one exercise a group is credited once per
 *   set, with the larger of its two credits: a curl that lists biceps
 *   primary and forearms secondary credits Arms 1.0 and Forearms 0.5, and a
 *   press listing biceps and triceps still gives Arms 1.0 per set, not 2
 *   (Brad, 21 Nov).
 * - Hard sets are whole completed sets where the group was primary
 *   (`n3b_shade` point 2: "Sets shown = completed sets where it was
 *   primary"). A secondary muscle earns credit but no hard sets (Brad,
 *   21 Nov). This is the "Quads · 14 sets" the coach sees.
 * - Shade = credit ÷ the group's weekly guide, capped at 1. The guide is 10
 *   for major groups and 6 for calves, core and forearms. It's weekly
 *   volume, not a recovery measurement.
 */

/** The ten groups the You page names, in Recap's canvas order. */
export const MUSCLE_DISPLAY_GROUPS = [
  "back",
  "quads",
  "chest",
  "shoulders",
  "glutes",
  "arms",
  "hamstrings",
  "core",
  "calves",
  "forearms",
] as const;

export type MuscleDisplayGroup = (typeof MUSCLE_DISPLAY_GROUPS)[number];

export const MUSCLE_DISPLAY_LABELS: Record<MuscleDisplayGroup, string> = {
  back: "Back",
  quads: "Quads",
  chest: "Chest",
  shoulders: "Shoulders",
  glutes: "Glutes",
  arms: "Arms",
  hamstrings: "Hamstrings",
  core: "Core",
  calves: "Calves",
  forearms: "Forearms",
};

/** Sets a group should get in a week: 10 major, 6 for calves, core, forearms. */
export const WEEKLY_GUIDE: Record<MuscleDisplayGroup, number> = {
  back: 10,
  quads: 10,
  chest: 10,
  shoulders: 10,
  glutes: 10,
  arms: 10,
  hamstrings: 10,
  core: 6,
  calves: 6,
  forearms: 6,
};

/**
 * Catalogue muscle → display group. Keys are the app's and the database's
 * muscle-group keys. Hip muscles sit with glutes and hip flexors with core,
 * the nearest group the page names. Unknown keys earn no credit.
 */
export const MUSCLE_TO_GROUP: Readonly<Record<string, MuscleDisplayGroup>> = {
  chest: "chest",
  back: "back",
  lats: "back",
  traps: "back",
  shoulders: "shoulders",
  biceps: "arms",
  triceps: "arms",
  forearms: "forearms",
  core: "core",
  hip_flexors: "core",
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  abductors: "glutes",
  adductors: "glutes",
  calves: "calves",
};

export type MuscleCreditInput = {
  primary: readonly string[];
  secondary: readonly string[];
  /** Completed sets of this exercise: reps > 0 and the exercise not skipped. */
  completedSets: number;
};

export type MuscleCreditRow = {
  group: MuscleDisplayGroup;
  label: string;
  /** Primary 1.0 + secondary 0.5 per completed set. */
  credit: number;
  /** Whole completed sets where the group was primary. */
  hardSets: number;
  weeklyGuide: number;
  /** credit ÷ weeklyGuide, capped at 1. */
  ratio: number;
  /** Rounded percentage of all credit; 0 when nothing was trained. */
  share: number;
  /** 0 untrained, 1–4 = 25 / 50 / 75 / 100 % of primary on the map. */
  level: 0 | 1 | 2 | 3 | 4;
};

/** Body-map shade level for a ratio: the four legend steps, Train → Rest. */
export function shadeLevel(ratio: number): MuscleCreditRow["level"] {
  if (!(ratio > 0)) return 0;
  if (ratio >= 1) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

/**
 * Credit every display group from a window's exercises. Always returns all
 * ten groups (untrained ones at 0) in canvas order, so callers can sort or
 * filter without missing a muscle.
 */
export function muscleCredit(
  inputs: readonly MuscleCreditInput[],
): MuscleCreditRow[] {
  const credit = new Map<MuscleDisplayGroup, number>();
  const hardSets = new Map<MuscleDisplayGroup, number>();
  for (const input of inputs) {
    if (!(input.completedSets > 0)) continue;
    const perSet = new Map<MuscleDisplayGroup, number>();
    for (const m of input.secondary) {
      const g = MUSCLE_TO_GROUP[m];
      if (g) perSet.set(g, Math.max(perSet.get(g) ?? 0, 0.5));
    }
    for (const m of input.primary) {
      const g = MUSCLE_TO_GROUP[m];
      if (g) perSet.set(g, 1);
    }
    for (const [g, c] of perSet) {
      credit.set(g, (credit.get(g) ?? 0) + c * input.completedSets);
      if (c === 1)
        hardSets.set(g, (hardSets.get(g) ?? 0) + input.completedSets);
    }
  }
  const total = [...credit.values()].reduce((a, b) => a + b, 0);
  return MUSCLE_DISPLAY_GROUPS.map((group) => {
    const c = credit.get(group) ?? 0;
    const ratio = Math.min(1, c / WEEKLY_GUIDE[group]);
    return {
      group,
      label: MUSCLE_DISPLAY_LABELS[group],
      credit: c,
      hardSets: hardSets.get(group) ?? 0,
      weeklyGuide: WEEKLY_GUIDE[group],
      ratio,
      share: total > 0 ? Math.round((c / total) * 100) : 0,
      level: shadeLevel(ratio),
    };
  });
}

export type TrainNextRest = {
  /** Short of their week, least done first. */
  trainNext: MuscleCreditRow[];
  /** Hit their week (ratio 1), most done first. */
  rest: MuscleCreditRow[];
};

/** Split the rows into the Y1 Train next and Rest groups. */
export function trainNextAndRest(
  rows: readonly MuscleCreditRow[],
): TrainNextRest {
  const order = (g: MuscleDisplayGroup) => MUSCLE_DISPLAY_GROUPS.indexOf(g);
  return {
    trainNext: rows
      .filter((r) => r.ratio < 1)
      .sort((a, b) => a.ratio - b.ratio || order(a.group) - order(b.group)),
    rest: rows
      .filter((r) => r.ratio >= 1)
      .sort((a, b) => b.credit - a.credit || order(a.group) - order(b.group)),
  };
}
