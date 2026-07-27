import { describe, it, expect } from "vitest";
import {
  assembleAdaptedPlan,
  partitionPlan,
  shortlistPerRow,
  SHORTLIST_PER_ROW,
  toExerciseDisplay,
  unionShortlist,
} from "../adaptWorkout";
import type { AdaptationCandidate } from "../../../repositories/exerciseRepository";
import type { WorkoutAdaptationRow } from "../../../repositories/workoutRepository";
import type { RemapSelection } from "../remapModel";

const CHEST = "m-chest";
const LEGS = "m-legs";
const BARBELL = "eq-barbell";
const DUMBBELL = "eq-dumbbell";
const BANDS = "eq-bands";

function ex(
  overrides: Partial<AdaptationCandidate> & { id: string; name: string },
): AdaptationCandidate {
  return {
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [],
    thumbnailUrl: null,
    ...overrides,
  };
}

function row(
  sortOrder: number,
  source: AdaptationCandidate,
  overrides: Partial<WorkoutAdaptationRow> = {},
): WorkoutAdaptationRow {
  return {
    workoutExerciseId: `we-${sortOrder}`,
    sortOrder,
    supersetGroup: null,
    targetSets: 4,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetDurationSeconds: null,
    restSeconds: 90,
    notes: null,
    source,
    ...overrides,
  };
}

const noLogs = { loggedExerciseIds: new Set<string>() };

function assemble(
  overrides: Partial<Parameters<typeof assembleAdaptedPlan>[0]>,
): ReturnType<typeof assembleAdaptedPlan> {
  return assembleAdaptedPlan({
    plan: [],
    shortlistByRow: new Map(),
    selections: new Map(),
    rankContext: noLogs,
    equipmentTypeIds: [],
    loadableEquipmentTypeIds: new Set(),
    candidateCount: 0,
    candidatePoolTruncated: false,
    modelId: null,
    ...overrides,
  });
}

describe("partitionPlan", () => {
  it("KEEPS a row whose equipment is fully contained by the context", () => {
    const plan = partitionPlan(
      [row(0, ex({ id: "a", name: "A", equipmentRequired: [DUMBBELL] }))],
      [DUMBBELL, BANDS],
    );

    expect(plan[0].needsSwap).toBe(false);
    expect(plan[0].missingEquipment).toEqual([]);
  });

  it("SWAPS a row missing any single requirement, and names what is missing", () => {
    // Containment, not overlap: having the bench is not enough for a barbell
    // bench press. This is the `@>` vs `&&` distinction the whole feature rests
    // on (§ 6.1).
    const plan = partitionPlan(
      [
        row(
          0,
          ex({ id: "a", name: "A", equipmentRequired: [BARBELL, DUMBBELL] }),
        ),
      ],
      [DUMBBELL],
    );

    expect(plan[0].needsSwap).toBe(true);
    expect(plan[0].missingEquipment).toEqual([BARBELL]);
  });

  it("KEEPS a bodyweight row in every context", () => {
    // `x ⊆ ∅` is always true — correct behaviour per § 6.1, and the same
    // semantics as the SQL `@> COALESCE(...)` predicate.
    const plan = partitionPlan(
      [row(0, ex({ id: "a", name: "A", equipmentRequired: [] }))],
      [BANDS],
    );

    expect(plan[0].needsSwap).toBe(false);
  });

  it("carries every target across unchanged", () => {
    const source = ex({ id: "a", name: "A", equipmentRequired: [BARBELL] });
    const original = row(3, source, {
      supersetGroup: 2,
      targetSets: 5,
      targetRepsMin: 4,
      targetRepsMax: 6,
      targetDurationSeconds: 30,
      restSeconds: 180,
      notes: "tempo",
    });

    const [partitioned] = partitionPlan([original], [BANDS]);

    expect(partitioned).toMatchObject({
      sortOrder: 3,
      supersetGroup: 2,
      targetSets: 5,
      targetRepsMin: 4,
      targetRepsMax: 6,
      targetDurationSeconds: 30,
      restSeconds: 180,
      notes: "tempo",
    });
  });
});

describe("shortlistPerRow / unionShortlist", () => {
  const needsSwap = ex({
    id: "src",
    name: "Barbell Bench",
    equipmentRequired: [BARBELL],
  });
  const kept = ex({ id: "kept", name: "Push-Up", equipmentRequired: [] });

  it("shortlists only rows that need a swap", () => {
    const plan = partitionPlan([row(0, kept), row(1, needsSwap)], [DUMBBELL]);
    const byRow = shortlistPerRow(
      plan,
      [ex({ id: "c1", name: "Candidate" })],
      noLogs,
    );

    expect(byRow.has(0)).toBe(false);
    expect(byRow.get(1)).toHaveLength(1);
  });

  it("caps each row at perRow entries", () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      ex({ id: `c${i}`, name: `Candidate ${String(i).padStart(2, "0")}` }),
    );
    const plan = partitionPlan([row(0, needsSwap)], [DUMBBELL]);

    expect(shortlistPerRow(plan, candidates, noLogs).get(0)).toHaveLength(
      SHORTLIST_PER_ROW,
    );
    expect(shortlistPerRow(plan, candidates, noLogs, 3).get(0)).toHaveLength(3);
  });

  it("dedupes the union across rows and sorts it by name", () => {
    const shared = ex({ id: "shared", name: "Zulu" });
    const other = ex({ id: "other", name: "Alpha" });
    const byRow = new Map([
      [0, [{ candidate: shared, score: 1, matchedOn: [] as never[] }]],
      [
        1,
        [
          { candidate: shared, score: 1, matchedOn: [] as never[] },
          { candidate: other, score: 1, matchedOn: [] as never[] },
        ],
      ],
    ]);

    expect(unionShortlist(byRow).map((c) => c.id)).toEqual(["other", "shared"]);
  });
});

describe("assembleAdaptedPlan — kept rows", () => {
  it("returns the parent exercise with a kept_compatible reason and no provenance", () => {
    const source = ex({ id: "a", name: "Push-Up" });
    const plan = partitionPlan([row(0, source)], [DUMBBELL]);

    const adapted = assemble({ plan, equipmentTypeIds: [DUMBBELL] });

    expect(adapted.rows[0]).toMatchObject({
      status: "kept",
      exerciseId: "a",
      substitutedFromExerciseId: null,
    });
    expect(adapted.rows[0].reason).toEqual({
      code: "kept_compatible",
      missingEquipment: [],
      matchedOn: [],
      flags: [],
      note: null,
      selectedBy: null,
    });
    expect(adapted.meta.keptCount).toBe(1);
  });

  it("ignores a model selection for a row that did not need a swap", () => {
    // Rule 2 of the prompt, enforced server-side: KEPT rows are a database
    // property. E2 saw the model answer for a fixed row once in 80 runs.
    const source = ex({ id: "a", name: "Push-Up" });
    const plan = partitionPlan([row(0, source)], [DUMBBELL]);
    const selections = new Map<number, RemapSelection>([
      [0, { rowKey: 0, exerciseId: "hijack", reason: "let me change this" }],
    ]);

    const adapted = assemble({
      plan,
      selections,
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[0].exerciseId).toBe("a");
    expect(adapted.rows[0].reason.note).toBeNull();
  });

  it("emits NO backend-authored prose — only codes, ids and the model's note", () => {
    // T-1.5: the backend emits codes and facts; mobile renders the sentence. The
    // eval's arms both wrote English here ("Kept · your kit has dumbbells") and
    // that must not ship. Asserted structurally rather than by keyword, because a
    // keyword test would match the enum values and field names themselves.
    const source = ex({
      id: "src",
      name: "Barbell Bench",
      equipmentRequired: [BARBELL],
    });
    const pick = ex({
      id: "pick",
      name: "Dumbbell Bench",
      equipmentRequired: [DUMBBELL],
    });
    const plan = partitionPlan(
      [row(0, ex({ id: "a", name: "Push-Up" })), row(1, source)],
      [DUMBBELL],
    );

    const adapted = assemble({
      plan,
      shortlistByRow: shortlistPerRow(plan, [pick], noLogs),
      selections: new Map([
        [1, { rowKey: 1, exerciseId: "pick", reason: "MODEL PROSE" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    const CODES = [
      "kept_compatible",
      "equipment_unavailable",
      "no_candidate",
      "user_override",
    ];
    const SIGNALS = [
      "primary_muscles",
      "secondary_muscles",
      "difficulty",
      "movement_type",
      "category",
      "logged_before",
    ];

    for (const { reason } of adapted.rows) {
      expect(CODES).toContain(reason.code);
      for (const signal of reason.matchedOn) expect(SIGNALS).toContain(signal);
      for (const flag of reason.flags) expect(flag).toBe("intensity_mismatch");
      // Equipment is reported as ids, never as names or a sentence.
      for (const id of reason.missingEquipment) expect(id).toBe(BARBELL);
      // The ONLY free text in the payload is what the model wrote, verbatim.
      expect(reason.note === null || reason.note === "MODEL PROSE").toBe(true);
    }
  });
});

describe("assembleAdaptedPlan — swapped rows", () => {
  const source = ex({
    id: "src",
    name: "Barbell Bench Press",
    equipmentRequired: [BARBELL],
  });
  const pick = ex({
    id: "pick",
    name: "Dumbbell Bench Press",
    equipmentRequired: [DUMBBELL],
  });

  function swapCase(
    selections: Map<number, RemapSelection>,
    candidates: AdaptationCandidate[] = [pick],
  ) {
    const plan = partitionPlan([row(0, source)], [DUMBBELL]);
    const shortlistByRow = shortlistPerRow(plan, candidates, noLogs);
    return assemble({
      plan,
      shortlistByRow,
      selections,
      equipmentTypeIds: [DUMBBELL],
      modelId: "test-model",
      candidateCount: candidates.length,
    });
  }

  it("takes the model's pick, keeps the parent's targets, and records provenance", () => {
    const adapted = swapCase(
      new Map([
        [0, { rowKey: 0, exerciseId: "pick", reason: "Dumbbells work here" }],
      ]),
    );

    expect(adapted.rows[0]).toMatchObject({
      status: "swapped",
      exerciseId: "pick",
      substitutedFromExerciseId: "src",
      // Targets are the parent's, untouched.
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      restSeconds: 90,
    });
    expect(adapted.rows[0].reason).toMatchObject({
      code: "equipment_unavailable",
      missingEquipment: [BARBELL],
      note: "Dumbbells work here",
      selectedBy: "model",
    });
    expect(adapted.rows[0].reason.matchedOn).toContain("primary_muscles");
    expect(adapted.rows[0].exercise).toEqual(toExerciseDisplay(pick));
    expect(adapted.meta.swappedCount).toBe(1);
  });

  it("honours an explicit null selection as unresolved (AC-3.4)", () => {
    // The model saying "nothing on this list fits" is a judgement, not a
    // protocol failure — it must NOT be overridden by the ranker.
    const adapted = swapCase(
      new Map([
        [0, { rowKey: 0, exerciseId: null, reason: "Nothing suitable" }],
      ]),
    );

    expect(adapted.rows[0]).toMatchObject({
      status: "unresolved",
      exerciseId: null,
      substitutedFromExerciseId: "src",
      exercise: null,
    });
    expect(adapted.rows[0].reason).toMatchObject({
      code: "no_candidate",
      missingEquipment: [BARBELL],
      note: "Nothing suitable",
      selectedBy: null,
    });
    expect(adapted.meta.unresolvedCount).toBe(1);
  });

  it("repairs a MISSING row from the shortlist and marks it selectedBy ranker", () => {
    const adapted = swapCase(new Map());

    expect(adapted.rows[0]).toMatchObject({
      status: "swapped",
      exerciseId: "pick",
    });
    expect(adapted.rows[0].reason.selectedBy).toBe("ranker");
  });

  it("drops a non-member id back to the ranker rather than trusting it", () => {
    // Membership is enforced in `remapModel` (422), so reaching here means the id
    // was not in the offered union — never accepted on trust.
    const adapted = swapCase(
      new Map([
        [0, { rowKey: 0, exerciseId: "invented", reason: "made this up" }],
      ]),
    );

    expect(adapted.rows[0].exerciseId).toBe("pick");
    expect(adapted.rows[0].reason.selectedBy).toBe("ranker");
  });

  it("repairs a pick that fails equipment containment", () => {
    // Structurally unreachable while stage 1 is correct, which is exactly why it
    // is checked: if the pool ever leaks, the row degrades to a repair instead of
    // shipping an exercise the user cannot perform.
    const illegal = ex({
      id: "illegal",
      name: "Cable Fly",
      equipmentRequired: ["eq-cable"],
    });
    const plan = partitionPlan([row(0, source)], [DUMBBELL]);
    const shortlistByRow = new Map([
      [
        0,
        [
          { candidate: illegal, score: 99, matchedOn: [] as never[] },
          { candidate: pick, score: 10, matchedOn: [] as never[] },
        ],
      ],
    ]);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "illegal", reason: "cables are great" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[0].exerciseId).toBe("pick");
    expect(adapted.rows[0].reason.selectedBy).toBe("ranker");
  });

  it("strips the model's sentence from a repaired row", () => {
    // The prose describes the exercise the model chose. Carrying it onto a
    // different exercise would attribute a rationale to the wrong row.
    const adapted = swapCase(
      new Map([
        [
          0,
          {
            rowKey: 0,
            exerciseId: "invented",
            reason: "about something else",
          },
        ],
      ]),
    );

    expect(adapted.rows[0].reason.note).toBeNull();
  });

  it("treats a blank model sentence as absent rather than empty prose", () => {
    const adapted = swapCase(
      new Map([[0, { rowKey: 0, exerciseId: "pick", reason: "   " }]]),
    );

    expect(adapted.rows[0].reason.note).toBeNull();
  });

  it("computes matchedOn for a pick ranked for a DIFFERENT row", () => {
    // The model is offered the union, so a cross-row pick is legitimate. It must
    // still get a populated `matchedOn` rather than an empty list that would read
    // as "no reason at all".
    const legPick = ex({
      id: "leg",
      name: "Dumbbell Squat",
      primaryMuscles: [LEGS],
      equipmentRequired: [DUMBBELL],
    });
    const legSource = ex({
      id: "leg-src",
      name: "Barbell Squat",
      primaryMuscles: [LEGS],
      equipmentRequired: [BARBELL],
    });

    const plan = partitionPlan([row(0, source), row(1, legSource)], [DUMBBELL]);
    const shortlistByRow = shortlistPerRow(plan, [pick, legPick], noLogs);

    // Row 0's shortlist contains only `pick` (chest); force the model to take
    // the leg candidate for it anyway.
    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "leg", reason: "cross-row" }],
        [1, { rowKey: 1, exerciseId: "pick", reason: "cross-row" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[0].exerciseId).toBe("leg");
    // No muscle overlap with the chest source → the ranker reports nothing, which
    // is honest. The row that DOES overlap reports the signal.
    expect(adapted.rows[0].reason.matchedOn).toEqual([]);
    expect(adapted.rows[1].reason.matchedOn).toEqual([]);
  });
});

describe("assembleAdaptedPlan — duplicate picks (T-1.4)", () => {
  it("repairs the second occurrence rather than shipping the same exercise twice", () => {
    const srcA = ex({
      id: "srcA",
      name: "Barbell Bench",
      equipmentRequired: [BARBELL],
    });
    const srcB = ex({
      id: "srcB",
      name: "Barbell Incline",
      equipmentRequired: [BARBELL],
    });
    const first = ex({
      id: "first",
      name: "AAA Dumbbell Press",
      equipmentRequired: [DUMBBELL],
    });
    const second = ex({
      id: "second",
      name: "BBB Dumbbell Fly",
      equipmentRequired: [DUMBBELL],
    });

    const plan = partitionPlan([row(0, srcA), row(1, srcB)], [DUMBBELL]);
    const shortlistByRow = shortlistPerRow(plan, [first, second], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "first", reason: "one" }],
        [1, { rowKey: 1, exerciseId: "first", reason: "also one" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows.map((r) => r.exerciseId)).toEqual(["first", "second"]);
    expect(adapted.rows[0].reason.selectedBy).toBe("model");
    expect(adapted.rows[1].reason.selectedBy).toBe("ranker");
  });

  it("does not let a swap duplicate an exercise the plan already KEEPS", () => {
    const keptEx = ex({
      id: "keeper",
      name: "Dumbbell Press",
      equipmentRequired: [DUMBBELL],
    });
    const swapSrc = ex({
      id: "src",
      name: "Barbell Press",
      equipmentRequired: [BARBELL],
    });
    const alternative = ex({
      id: "alt",
      name: "ZZZ Dumbbell Fly",
      equipmentRequired: [DUMBBELL],
    });

    const plan = partitionPlan([row(0, keptEx), row(1, swapSrc)], [DUMBBELL]);
    const shortlistByRow = new Map([
      [
        1,
        [
          { candidate: keptEx, score: 99, matchedOn: [] as never[] },
          { candidate: alternative, score: 1, matchedOn: [] as never[] },
        ],
      ],
    ]);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [1, { rowKey: 1, exerciseId: "keeper", reason: "reuse it" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[1].exerciseId).toBe("alt");
  });

  it("falls through to unresolved when every shortlist entry is taken", () => {
    const srcA = ex({ id: "srcA", name: "A", equipmentRequired: [BARBELL] });
    const srcB = ex({ id: "srcB", name: "B", equipmentRequired: [BARBELL] });
    const only = ex({
      id: "only",
      name: "Only Option",
      equipmentRequired: [DUMBBELL],
    });

    const plan = partitionPlan([row(0, srcA), row(1, srcB)], [DUMBBELL]);
    const shortlistByRow = shortlistPerRow(plan, [only], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "only", reason: "one" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[0].status).toBe("swapped");
    expect(adapted.rows[1].status).toBe("unresolved");
    expect(adapted.meta.unresolvedCount).toBe(1);
  });
});

describe("assembleAdaptedPlan — intensity mismatch (AC-3.5b)", () => {
  const LOADABLE = new Set([BARBELL]);

  it("flags a strength row swapped onto unloadable kit, and counts it", () => {
    const source = ex({
      id: "src",
      name: "Barbell Deadlift",
      equipmentRequired: [BARBELL],
    });
    const bandPick = ex({
      id: "band",
      name: "Band Good Morning",
      equipmentRequired: [BANDS],
    });

    const plan = partitionPlan(
      [row(0, source, { targetRepsMin: 4, targetRepsMax: 6 })],
      [BANDS],
    );
    const shortlistByRow = shortlistPerRow(plan, [bandPick], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "band", reason: "hinge for hinge" }],
      ]),
      equipmentTypeIds: [BANDS],
      loadableEquipmentTypeIds: LOADABLE,
    });

    expect(adapted.rows[0].status).toBe("swapped");
    expect(adapted.rows[0].reason.flags).toEqual(["intensity_mismatch"]);
    expect(adapted.meta.intensityMismatchCount).toBe(1);
  });

  it("does not flag a hypertrophy row on the same swap", () => {
    const source = ex({
      id: "src",
      name: "Barbell Row",
      equipmentRequired: [BARBELL],
    });
    const bandPick = ex({
      id: "band",
      name: "Band Row",
      equipmentRequired: [BANDS],
    });

    const plan = partitionPlan(
      [row(0, source, { targetRepsMin: 10, targetRepsMax: 12 })],
      [BANDS],
    );
    const shortlistByRow = shortlistPerRow(plan, [bandPick], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "band", reason: "row for row" }],
      ]),
      equipmentTypeIds: [BANDS],
      loadableEquipmentTypeIds: LOADABLE,
    });

    expect(adapted.rows[0].reason.flags).toEqual([]);
    expect(adapted.meta.intensityMismatchCount).toBe(0);
  });
});

describe("assembleAdaptedPlan — meta", () => {
  it("reports counts, pool size, truncation and the model id", () => {
    const source = ex({
      id: "src",
      name: "Barbell Bench",
      equipmentRequired: [BARBELL],
    });
    const kept = ex({ id: "kept", name: "Push-Up" });
    const plan = partitionPlan([row(0, kept), row(1, source)], [DUMBBELL]);

    const adapted = assemble({
      plan,
      shortlistByRow: shortlistPerRow(plan, [], noLogs),
      equipmentTypeIds: [DUMBBELL],
      candidateCount: 400,
      candidatePoolTruncated: true,
      modelId: "eu.anthropic.test",
    });

    expect(adapted.meta).toEqual({
      keptCount: 1,
      swappedCount: 0,
      unresolvedCount: 1,
      intensityMismatchCount: 0,
      candidateCount: 400,
      candidatePoolTruncated: true,
      modelId: "eu.anthropic.test",
    });
  });

  it("preserves the parent's row order", () => {
    const plan = partitionPlan(
      [
        row(0, ex({ id: "a", name: "A" })),
        row(1, ex({ id: "b", name: "B" })),
        row(2, ex({ id: "c", name: "C" })),
      ],
      [DUMBBELL],
    );

    const adapted = assemble({ plan, equipmentTypeIds: [DUMBBELL] });

    expect(adapted.rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("assembleAdaptedPlan — duplicate sort_order in the parent", () => {
  // `workout_exercises.sort_order` has NO unique constraint and is written
  // verbatim from the client, so two rows can share one — including via a
  // stranger's public workout, which AC-1.2 makes adaptable. Keying the internal
  // maps on it collapsed one row's shortlist into the other's and produced a
  // cross-muscle substitution through the guards rather than around them.
  const chestSource = ex({
    id: "chest-src",
    name: "Barbell Bench Press",
    primaryMuscles: [CHEST],
    equipmentRequired: [BARBELL],
  });
  const legSource = ex({
    id: "leg-src",
    name: "Barbell Squat",
    primaryMuscles: [LEGS],
    equipmentRequired: [BARBELL],
  });
  const chestAlt = ex({
    id: "chest-alt",
    name: "Dumbbell Bench Press",
    primaryMuscles: [CHEST],
    equipmentRequired: [DUMBBELL],
  });
  const legAlt = ex({
    id: "leg-alt",
    name: "Dumbbell Squat",
    primaryMuscles: [LEGS],
    equipmentRequired: [DUMBBELL],
  });

  it("gives colliding rows distinct row keys", () => {
    const plan = partitionPlan(
      [row(0, chestSource), row(0, legSource)],
      [DUMBBELL],
    );

    expect(plan.map((r) => r.rowKey)).toEqual([0, 1]);
    // …while the parent's own sort_order is carried through untouched.
    expect(plan.map((r) => r.sortOrder)).toEqual([0, 0]);
  });

  it("shortlists BOTH rows rather than overwriting one", () => {
    const plan = partitionPlan(
      [row(0, chestSource), row(0, legSource)],
      [DUMBBELL],
    );
    const byRow = shortlistPerRow(plan, [chestAlt, legAlt], noLogs);

    expect(byRow.size).toBe(2);
    expect(byRow.get(0)?.map((e) => e.candidate.id)).toEqual(["chest-alt"]);
    expect(byRow.get(1)?.map((e) => e.candidate.id)).toEqual(["leg-alt"]);
    // The union offered to the model therefore keeps both candidates.
    expect(unionShortlist(byRow).map((c) => c.id)).toEqual([
      "chest-alt",
      "leg-alt",
    ]);
  });

  it("resolves each row to its OWN muscle group", () => {
    const plan = partitionPlan(
      [row(0, chestSource), row(0, legSource)],
      [DUMBBELL],
    );
    const shortlistByRow = shortlistPerRow(plan, [chestAlt, legAlt], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "chest-alt", reason: "press for press" }],
        [1, { rowKey: 1, exerciseId: "leg-alt", reason: "squat for squat" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows.map((r) => r.exerciseId)).toEqual([
      "chest-alt",
      "leg-alt",
    ]);
    expect(adapted.rows.every((r) => r.reason.selectedBy === "model")).toBe(
      true,
    );
    expect(adapted.meta.unresolvedCount).toBe(0);
  });
});

describe("assembleAdaptedPlan — note provenance on unresolved rows", () => {
  it("does NOT attribute the model's sentence to a repair-exhausted row", () => {
    // The model named one exercise for two rows. Row 0 takes it; row 1 hits the
    // duplicate guard, finds nothing left, and ships unresolved. Carrying the
    // note there would put a rationale for an exercise that is not in the plan
    // onto a row that has no exercise at all.
    const srcA = ex({ id: "srcA", name: "A", equipmentRequired: [BARBELL] });
    const srcB = ex({ id: "srcB", name: "B", equipmentRequired: [BARBELL] });
    const only = ex({
      id: "only",
      name: "Only",
      equipmentRequired: [DUMBBELL],
    });

    const plan = partitionPlan([row(0, srcA), row(1, srcB)], [DUMBBELL]);
    const shortlistByRow = shortlistPerRow(plan, [only], noLogs);

    const adapted = assemble({
      plan,
      shortlistByRow,
      selections: new Map([
        [0, { rowKey: 0, exerciseId: "only", reason: "Only also fits row B" }],
        [1, { rowKey: 1, exerciseId: "only", reason: "Only also fits row B" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[1].status).toBe("unresolved");
    expect(adapted.rows[1].reason.note).toBeNull();
  });

  it("DOES carry the sentence when the model explicitly declined the row", () => {
    // Here the prose is about this row's impossibility, which is the one case
    // worth showing (AC-3.4).
    const source = ex({ id: "src", name: "A", equipmentRequired: [BARBELL] });
    const plan = partitionPlan([row(0, source)], [DUMBBELL]);

    const adapted = assemble({
      plan,
      shortlistByRow: shortlistPerRow(plan, [], noLogs),
      selections: new Map([
        [0, { rowKey: 0, exerciseId: null, reason: "Bands can't hinge heavy" }],
      ]),
      equipmentTypeIds: [DUMBBELL],
    });

    expect(adapted.rows[0].reason.note).toBe("Bands can't hinge heavy");
  });
});
