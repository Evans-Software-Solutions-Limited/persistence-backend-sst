import {
  buildVariationExercises,
  deriveVariationName,
  describeLoadoutRow,
  describeMatchSignals,
  EQUIPMENT_OTHER_CATEGORY,
  groupEquipmentForPicker,
  rowsNeedingAttention,
  scanDraftToEquipmentIds,
  type ManualPick,
} from "@/domain/services/loadout.service";
import { isEquipmentGroupingStale } from "@/domain/models/reference-list";
import type {
  LoadoutPreview,
  LoadoutPreviewRow,
  SubstitutionReason,
} from "@/domain/models/loadout";
import type { ReferenceEntry } from "@/domain/models/reference-list";

const DUMBBELL = "eq-dumbbell";
const BARBELL = "eq-barbell";

const EQUIPMENT_NAMES = new Map([
  [DUMBBELL, "Dumbbells"],
  [BARBELL, "Barbell"],
]);

function reason(
  overrides: Partial<SubstitutionReason> = {},
): SubstitutionReason {
  return {
    code: "kept_compatible",
    missingEquipment: [],
    matchedOn: [],
    flags: [],
    note: null,
    selectedBy: null,
    ...overrides,
  };
}

function row(overrides: Partial<LoadoutPreviewRow> = {}): LoadoutPreviewRow {
  return {
    sortOrder: 0,
    status: "kept",
    exerciseId: "ex-1",
    substitutedFromExerciseId: null,
    reason: reason(),
    exercise: {
      id: "ex-1",
      name: "Dumbbell Bench Press",
      category: "strength",
      difficultyLevel: "intermediate",
      thumbnailUrl: null,
      equipmentRequired: [DUMBBELL],
    },
    supersetGroup: null,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetDurationSeconds: null,
    restSeconds: 90,
    notes: null,
    ...overrides,
  };
}

function preview(rows: LoadoutPreviewRow[]): LoadoutPreview {
  return {
    workoutId: "w-1",
    parentName: "Upper Body",
    savedGymId: "gym-1",
    equipmentTypeIds: [DUMBBELL],
    rows,
    meta: {
      keptCount: 0,
      swappedCount: 0,
      unresolvedCount: 0,
      intensityMismatchCount: 0,
      candidateCount: 0,
      candidatePoolTruncated: false,
      modelId: null,
    },
  };
}

describe("describeMatchSignals", () => {
  it("returns null with no signals", () => {
    expect(describeMatchSignals([])).toBeNull();
  });

  it("renders a single signal bare", () => {
    expect(describeMatchSignals(["primary_muscles"])).toBe(
      "same primary muscles",
    );
  });

  it("joins two with 'and'", () => {
    expect(describeMatchSignals(["primary_muscles", "logged_before"])).toBe(
      "same primary muscles and you've trained it before",
    );
  });

  it("joins three with commas and a final 'and'", () => {
    expect(
      describeMatchSignals(["primary_muscles", "difficulty", "logged_before"]),
    ).toBe(
      "same primary muscles, same difficulty and you've trained it before",
    );
  });

  it("caps at three so a fully-matched row stays readable", () => {
    const phrase = describeMatchSignals([
      "primary_muscles",
      "secondary_muscles",
      "difficulty",
      "movement_type",
      "category",
      "logged_before",
    ]);
    expect(phrase).toBe(
      "same primary muscles, similar supporting muscles and same difficulty",
    );
    expect(phrase).not.toContain("trained it before");
  });

  it("ignores an unrecognised signal rather than rendering undefined", () => {
    // A backend that adds a seventh RankSignal must not put the string
    // "undefined" in front of a user.
    const phrase = describeMatchSignals([
      "primary_muscles",
      "brand_new_signal" as never,
    ]);
    expect(phrase).toBe("same primary muscles");
  });
});

describe("describeLoadoutRow", () => {
  it("describes a kept row with the success tone", () => {
    const copy = describeLoadoutRow(row(), EQUIPMENT_NAMES);
    expect(copy.badge).toBe("KEPT");
    expect(copy.tone).toBe("kept");
    expect(copy.intensityMismatch).toBe(false);
  });

  it("names the missing equipment and the match signals on a swap", () => {
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        substitutedFromExerciseId: "ex-0",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: [BARBELL],
          matchedOn: ["primary_muscles", "logged_before"],
          selectedBy: "model",
        }),
      }),
      EQUIPMENT_NAMES,
    );

    expect(copy.badge).toBe("SWAPPED");
    expect(copy.tone).toBe("swapped");
    expect(copy.explanation).toBe(
      "No Barbell available · same primary muscles and you've trained it before",
    );
  });

  it("makes NO equipment claim when the missing ids cannot be resolved", () => {
    // A uuid in a sentence is worse than a vaguer sentence, and "No  available"
    // is worse than both.
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: ["eq-unknown"],
          matchedOn: ["primary_muscles"],
        }),
      }),
      EQUIPMENT_NAMES,
    );

    expect(copy.explanation).toBe(
      "Swapped for your kit · same primary muscles",
    );
    expect(copy.explanation).not.toContain("eq-unknown");
    expect(copy.explanation).not.toContain("No  ");
  });

  it("resolves only the names it knows, dropping the rest", () => {
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: [BARBELL, "eq-unknown"],
        }),
      }),
      EQUIPMENT_NAMES,
    );
    expect(copy.explanation).toBe("No Barbell available");
  });

  it("describes an unresolved row as needing attention", () => {
    const copy = describeLoadoutRow(
      row({
        status: "unresolved",
        exerciseId: null,
        exercise: null,
        reason: reason({
          code: "no_candidate",
          missingEquipment: [BARBELL],
        }),
      }),
      EQUIPMENT_NAMES,
    );

    expect(copy.badge).toBe("NO MATCH");
    expect(copy.tone).toBe("attention");
    expect(copy.explanation).toBe(
      "Nothing in your kit replaces this — needs Barbell.",
    );
  });

  it("describes an unresolved row with unknown equipment without naming it", () => {
    const copy = describeLoadoutRow(
      row({
        status: "unresolved",
        exerciseId: null,
        reason: reason({ code: "no_candidate", missingEquipment: ["eq-?"] }),
      }),
      EQUIPMENT_NAMES,
    );
    expect(copy.explanation).toBe("Nothing in your kit replaces this one.");
  });

  it("describes a user override as the user's own choice", () => {
    const copy = describeLoadoutRow(
      row({ status: "swapped", reason: reason({ code: "user_override" }) }),
      EQUIPMENT_NAMES,
    );
    expect(copy.badge).toBe("YOUR PICK");
    expect(copy.explanation).toBe("You chose this one.");
  });

  it("escalates a KEPT row's tone to attention when the intensity is wrong", () => {
    // AC-3.5b: the exercise is right and the PRESCRIPTION is not. A kept row with
    // this flag still needs the user, so it must not render as a quiet green tick.
    const copy = describeLoadoutRow(
      row({ reason: reason({ flags: ["intensity_mismatch"] }) }),
      EQUIPMENT_NAMES,
    );

    expect(copy.badge).toBe("KEPT");
    expect(copy.tone).toBe("attention");
    expect(copy.intensityMismatch).toBe(true);
  });

  it("escalates a SWAPPED row's tone to attention on the same flag", () => {
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        reason: reason({
          code: "equipment_unavailable",
          flags: ["intensity_mismatch"],
        }),
      }),
      EQUIPMENT_NAMES,
    );
    expect(copy.tone).toBe("attention");
  });

  it("keeps the model's note in its OWN field, never spliced into our copy", () => {
    // The separation is the security boundary: `explanation` is ours and safe to
    // style freely, `modelNote` is untrusted and must be rendered as plain text.
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: [BARBELL],
          note: "[tap here](http://evil.example) to continue",
        }),
      }),
      EQUIPMENT_NAMES,
    );

    expect(copy.modelNote).toBe("[tap here](http://evil.example) to continue");
    expect(copy.explanation).not.toContain("evil.example");
    expect(copy.explanation).toBe("No Barbell available");
  });

  it("normalises an empty or whitespace-only note to null", () => {
    expect(
      describeLoadoutRow(row({ reason: reason({ note: "" }) })).modelNote,
    ).toBeNull();
    expect(
      describeLoadoutRow(row({ reason: reason({ note: "   \n " }) })).modelNote,
    ).toBeNull();
  });

  it("trims a note rather than rendering leading whitespace", () => {
    expect(
      describeLoadoutRow(row({ reason: reason({ note: "  fits your kit  " }) }))
        .modelNote,
    ).toBe("fits your kit");
  });

  it("works with no equipment-name map at all", () => {
    const copy = describeLoadoutRow(
      row({
        status: "swapped",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: [BARBELL],
        }),
      }),
    );
    expect(copy.explanation).toBe("Swapped for your kit");
  });
});

describe("rowsNeedingAttention", () => {
  it("collects unresolved rows and intensity mismatches, and nothing else", () => {
    const rows = [
      row({ sortOrder: 0 }),
      row({ sortOrder: 1, status: "unresolved", exerciseId: null }),
      row({
        sortOrder: 2,
        reason: reason({ flags: ["intensity_mismatch"] }),
      }),
      row({
        sortOrder: 3,
        status: "swapped",
        reason: reason({ code: "equipment_unavailable" }),
      }),
    ];

    expect(rowsNeedingAttention(preview(rows)).map((r) => r.sortOrder)).toEqual(
      [1, 2],
    );
  });

  it("returns nothing for a fully clean plan", () => {
    expect(rowsNeedingAttention(preview([row()]))).toHaveLength(0);
  });
});

describe("buildVariationExercises", () => {
  it("round-trips the parent's targets verbatim", () => {
    // design § 1 rule 2: targets are a database property, never model output, and
    // nothing in the review step may edit them.
    const rows = buildVariationExercises(
      preview([
        row({
          supersetGroup: 2,
          targetSets: 4,
          targetRepsMin: 4,
          targetRepsMax: 6,
          targetDurationSeconds: 45,
          restSeconds: 120,
          notes: "slow eccentric",
        }),
      ]),
    );

    expect(rows[0]).toMatchObject({
      supersetGroup: 2,
      targetSets: 4,
      targetRepsMin: 4,
      targetRepsMax: 6,
      targetDurationSeconds: 45,
      restSeconds: 120,
      notes: "slow eccentric",
    });
  });

  it("round-trips substitutionReason so the variation can explain itself later", () => {
    const original = reason({
      code: "equipment_unavailable",
      missingEquipment: [BARBELL],
      matchedOn: ["primary_muscles"],
      note: "Dumbbells work here",
      selectedBy: "model",
    });
    const rows = buildVariationExercises(
      preview([
        row({
          status: "swapped",
          substitutedFromExerciseId: "ex-0",
          reason: original,
        }),
      ]),
    );

    expect(rows[0].substitutionReason).toEqual(original);
    expect(rows[0].substitutedFromExerciseId).toBe("ex-0");
  });

  it("omits isUserOverride entirely on a plan with no manual picks", () => {
    // Sending `isUserOverride: false` would be harmless today, but the flag's
    // meaning is "the user acknowledged this does not fit" — asserting its absence
    // pins that it is never set speculatively.
    const rows = buildVariationExercises(preview([row()]));
    expect(rows[0]).not.toHaveProperty("isUserOverride");
  });

  it("sets isUserOverride: true for an acknowledged incompatible pick", () => {
    // THE trap: without this the save 400s EQUIPMENT_NOT_AVAILABLE and the user
    // loses a reviewed adaptation to an error they cannot act on.
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: true }],
    ]);
    const rows = buildVariationExercises(
      preview([
        row({
          status: "swapped",
          reason: reason({
            code: "equipment_unavailable",
            missingEquipment: [BARBELL],
          }),
        }),
      ]),
      picks,
    );

    expect(rows[0].exerciseId).toBe("ex-9");
    expect(rows[0].isUserOverride).toBe(true);
  });

  it("does NOT set isUserOverride for a manual pick from the compatible list", () => {
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: false }],
    ]);
    const rows = buildVariationExercises(preview([row()]), picks);

    expect(rows[0].exerciseId).toBe("ex-9");
    expect(rows[0]).not.toHaveProperty("isUserOverride");
  });

  it("rewrites the reason to user_override, dropping the model's sentence", () => {
    // Keeping the model's note would attribute the USER's choice to the model.
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: true }],
    ]);
    const rows = buildVariationExercises(
      preview([
        row({
          status: "swapped",
          reason: reason({
            code: "equipment_unavailable",
            missingEquipment: [BARBELL],
            matchedOn: ["primary_muscles"],
            note: "the model's sentence",
            selectedBy: "model",
          }),
        }),
      ]),
      picks,
    );

    expect(rows[0].substitutionReason).toEqual({
      code: "user_override",
      // The kit gap is still a fact about the row.
      missingEquipment: [BARBELL],
      matchedOn: [],
      flags: [],
      note: null,
      selectedBy: null,
    });
  });

  it("records the replaced exercise when the user overrides a KEPT row", () => {
    // Without this the provenance would read as though nothing changed.
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: false }],
    ]);
    const rows = buildVariationExercises(
      preview([row({ exerciseId: "ex-1" })]),
      picks,
    );
    expect(rows[0].substitutedFromExerciseId).toBe("ex-1");
  });

  it("never records a row as substituted from itself", () => {
    // Picking the exercise that is already there is a no-op, and claiming a swap
    // would inflate the variation's swapCount.
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-1", isUserOverride: false }],
    ]);
    const rows = buildVariationExercises(
      preview([row({ exerciseId: "ex-1" })]),
      picks,
    );
    expect(rows[0].substitutedFromExerciseId).toBeNull();
  });

  it("DROPS an unresolved row with no manual pick", () => {
    // The wire schema requires an exerciseId, so sending it would be a 422.
    const rows = buildVariationExercises(
      preview([
        row({ sortOrder: 0 }),
        row({
          sortOrder: 1,
          status: "unresolved",
          exerciseId: null,
          exercise: null,
        }),
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].sortOrder).toBe(0);
  });

  it("KEEPS an unresolved row once the user picks something for it", () => {
    const picks = new Map<number, ManualPick>([
      [1, { exerciseId: "ex-9", isUserOverride: true }],
    ]);
    const rows = buildVariationExercises(
      preview([
        row({ sortOrder: 0 }),
        row({
          sortOrder: 1,
          status: "unresolved",
          exerciseId: null,
          exercise: null,
          reason: reason({ code: "no_candidate", missingEquipment: [BARBELL] }),
        }),
      ]),
      picks,
    );

    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
    expect(rows[1].exerciseId).toBe("ex-9");
    expect(rows[1].isUserOverride).toBe(true);
    // Nothing to substitute FROM — the row never had an exercise.
    expect(rows[1].substitutedFromExerciseId).toBeNull();
  });

  it("keys manual picks on sortOrder, not array position", () => {
    // The plan's sortOrder values are the parent's and need not be 0..n-1.
    const picks = new Map<number, ManualPick>([
      [7, { exerciseId: "ex-9", isUserOverride: false }],
    ]);
    const rows = buildVariationExercises(
      preview([row({ sortOrder: 3 }), row({ sortOrder: 7 })]),
      picks,
    );

    expect(rows[0].exerciseId).toBe("ex-1");
    expect(rows[1].exerciseId).toBe("ex-9");
  });

  it("preserves an intensity_mismatch flag through a manual pick", () => {
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: true }],
    ]);
    const rows = buildVariationExercises(
      preview([
        row({
          reason: reason({
            code: "equipment_unavailable",
            flags: ["intensity_mismatch"],
          }),
        }),
      ]),
      picks,
    );
    expect(rows[0].substitutionReason?.flags).toEqual(["intensity_mismatch"]);
  });

  it("returns an empty array for a plan with nothing savable", () => {
    expect(
      buildVariationExercises(
        preview([row({ status: "unresolved", exerciseId: null })]),
      ),
    ).toEqual([]);
  });
});

describe("deriveVariationName", () => {
  it("joins the parent and the gym", () => {
    expect(deriveVariationName("Upper Body", "Hotel gym")).toBe(
      "Upper Body · Hotel gym",
    );
  });

  it("falls back to the parent alone with no gym name", () => {
    expect(deriveVariationName("Upper Body", null)).toBe("Upper Body");
  });

  it("caps at the endpoint's 200-char limit", () => {
    // A long parent name must not fail validation on a field the user never typed.
    const name = deriveVariationName("x".repeat(250), "Hotel gym");
    expect(name).toHaveLength(200);
  });
});

describe("groupEquipmentForPicker", () => {
  function entry(
    id: string,
    name: string,
    category?: string | null,
  ): ReferenceEntry {
    return category === undefined
      ? { id, name, displayName: null }
      : { id, name, displayName: null, category };
  }

  it("groups by the API's category in a fixed display order", () => {
    // Fixed order, NOT the catalogue's, so the picker does not reshuffle when a
    // row is seeded.
    const groups = groupEquipmentForPicker([
      entry("3", "Treadmill", "cardio"),
      entry("1", "Dumbbells", "free_weights"),
      entry("2", "Leg Press", "machines"),
    ]);

    expect(groups.map((g) => g.category)).toEqual([
      "free_weights",
      "machines",
      "cardio",
    ]);
    expect(groups[0].label).toBe("Free weights");
  });

  it("omits a category with no rows", () => {
    const groups = groupEquipmentForPicker([
      entry("1", "Dumbbells", "free_weights"),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("buckets a null category under Other and keeps it SELECTABLE", () => {
    // Dropping it would make a real piece of equipment unreachable, silently —
    // the same failure class as T-E.10's unmapped equipment names.
    const groups = groupEquipmentForPicker([
      entry("1", "Dumbbells", "free_weights"),
      entry("2", "Mystery Machine", null),
    ]);

    const other = groups.find((g) => g.category === EQUIPMENT_OTHER_CATEGORY);
    expect(other?.label).toBe("Other");
    expect(other?.items.map((i) => i.name)).toEqual(["Mystery Machine"]);
  });

  it("buckets an UNRECOGNISED category under Other rather than inventing a group", () => {
    // A seventh category seeded server-side must not produce an unlabelled group.
    const groups = groupEquipmentForPicker([entry("1", "Sauna", "wellness")]);
    expect(groups.map((g) => g.category)).toEqual([EQUIPMENT_OTHER_CATEGORY]);
  });

  it("puts Other LAST", () => {
    const groups = groupEquipmentForPicker([
      entry("1", "Mystery", null),
      entry("2", "Dumbbells", "free_weights"),
    ]);
    expect(groups[groups.length - 1].category).toBe(EQUIPMENT_OTHER_CATEGORY);
  });

  it("preserves catalogue order within a group", () => {
    const groups = groupEquipmentForPicker([
      entry("1", "Barbell", "free_weights"),
      entry("2", "Dumbbells", "free_weights"),
    ]);
    expect(groups[0].items.map((i) => i.name)).toEqual([
      "Barbell",
      "Dumbbells",
    ]);
  });

  it("returns nothing for an empty catalogue", () => {
    expect(groupEquipmentForPicker([])).toEqual([]);
  });
});

describe("isEquipmentGroupingStale", () => {
  it("flags a pre-Loadout cache entry that has no category key at all", () => {
    // Absent ≠ uncategorised. Without this check a returning user's cached list
    // would render every chip under "Other" for up to 24h.
    expect(
      isEquipmentGroupingStale([
        { id: "1", name: "Dumbbells", displayName: null },
      ]),
    ).toBe(true);
  });

  it("does NOT flag an entry whose category is explicitly null", () => {
    expect(
      isEquipmentGroupingStale([
        { id: "1", name: "Mystery", displayName: null, category: null },
      ]),
    ).toBe(false);
  });

  it("does not flag a fully categorised list", () => {
    expect(
      isEquipmentGroupingStale([
        {
          id: "1",
          name: "Dumbbells",
          displayName: null,
          category: "free_weights",
        },
      ]),
    ).toBe(false);
  });

  it("flags a MIXED list — one stale row is enough", () => {
    expect(
      isEquipmentGroupingStale([
        {
          id: "1",
          name: "Dumbbells",
          displayName: null,
          category: "free_weights",
        },
        { id: "2", name: "Old", displayName: null },
      ]),
    ).toBe(true);
  });

  it("treats an empty list as not stale", () => {
    // Nothing to group; a refresh would be pointless churn.
    expect(isEquipmentGroupingStale([])).toBe(false);
  });
});

describe("scanDraftToEquipmentIds", () => {
  const draft = {
    detected: [
      {
        equipmentTypeId: "eq-bw",
        name: "Bodyweight",
        confidence: 1,
        source: "injected" as const,
      },
      {
        equipmentTypeId: DUMBBELL,
        name: "Dumbbells",
        confidence: 0.9,
        source: "model" as const,
      },
    ],
    unmatched: [{ label: "landmine attachment", confidence: 0.6 }],
    notes: null,
    modelId: "test-model",
  };

  it("takes only the matched detections", () => {
    // `unmatched` has no catalogue id, so there is nothing to select.
    expect(scanDraftToEquipmentIds(draft)).toEqual(["eq-bw", DUMBBELL]);
  });

  it("honours the user unticking a false positive", () => {
    // The whole point of the draft being a draft (AC-2.3) — E1's recall was
    // measured on mostly-stock photos and is a ceiling, not a real-world rate.
    expect(scanDraftToEquipmentIds(draft, new Set([DUMBBELL]))).toEqual([
      "eq-bw",
    ]);
  });

  it("allows everything to be deselected", () => {
    expect(
      scanDraftToEquipmentIds(draft, new Set(["eq-bw", DUMBBELL])),
    ).toEqual([]);
  });

  it("returns nothing for an empty draft", () => {
    expect(
      scanDraftToEquipmentIds({
        detected: [],
        unmatched: [],
        notes: null,
        modelId: "m",
      }),
    ).toEqual([]);
  });
});
