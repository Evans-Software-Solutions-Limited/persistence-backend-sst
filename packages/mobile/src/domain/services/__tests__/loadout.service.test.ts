import {
  buildVariationExercises,
  deriveVariationName,
  describeLoadoutRow,
  describeMatchSignals,
  EQUIPMENT_OTHER_CATEGORY,
  groupEquipmentForPicker,
  describeVariationSaveError,
  CODES_NOT_EMITTED_BY_VARIATION_SAVE,
  hasGymEquipmentChanged,
  rowsNeedingAttention,
  scanDraftToEquipmentIds,
  type ManualPick,
} from "@/domain/services/loadout.service";
import { LOADOUT_ERROR_CODES } from "@/domain/ports/api.port";
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

describe("hasGymEquipmentChanged", () => {
  const variation = {
    sourceGymId: "gym-1",
    sourceEquipmentTypeIds: ["eq-dumbbell", "eq-cable"],
    currentSourceGymEquipmentTypeIds: ["eq-cable", "eq-dumbbell"],
  };

  it("compares equipment as a set, ignoring order and duplicates", () => {
    expect(hasGymEquipmentChanged(variation)).toBe(false);
    expect(
      hasGymEquipmentChanged({
        ...variation,
        currentSourceGymEquipmentTypeIds: [
          "eq-cable",
          "eq-dumbbell",
          "eq-dumbbell",
        ],
      }),
    ).toBe(false);
  });

  it("detects equipment additions and removals", () => {
    expect(
      hasGymEquipmentChanged({
        ...variation,
        currentSourceGymEquipmentTypeIds: [
          "eq-cable",
          "eq-dumbbell",
          "eq-rack",
        ],
      }),
    ).toBe(true);
    expect(
      hasGymEquipmentChanged({
        ...variation,
        currentSourceGymEquipmentTypeIds: ["eq-dumbbell"],
      }),
    ).toBe(true);
  });

  it("does not claim a change after the source gym was deleted", () => {
    expect(
      hasGymEquipmentChanged({
        ...variation,
        sourceGymId: null,
        currentSourceGymEquipmentTypeIds: null,
      }),
    ).toBe(false);
  });

  /**
   * Real staging data, 2026-08-02: `Mock Gym` holds 3 equipment ids with
   * `updated_at == created_at` — never modified — while its variation
   * `Upper · Mock Gym` has `source_equipment_type_ids = '{}'`. Comparing 0
   * against 3 told the user "Your gym equipment has changed since this setup was
   * made" about a gym nobody had touched, permanently: no action can make the
   * two sides agree, and there is no kit to backfill because none was recorded.
   */
  it("treats an EMPTY frozen snapshot as unrecorded, not as a changed kit", () => {
    expect(
      hasGymEquipmentChanged({
        ...variation,
        sourceEquipmentTypeIds: [],
        currentSourceGymEquipmentTypeIds: [
          "7802e4da-261f-4b77-a9b1-cafa8e70b142",
          "bc456e03-f3d8-40bc-a4ad-41a604e8374a",
          "d01433d3-23e6-4c6f-98c6-c94927242260",
        ],
      }),
    ).toBe(false);
  });

  it("still reports a real change when the gym is emptied under a real snapshot", () => {
    // The mirror case, so the guard cannot be widened into "never report".
    expect(
      hasGymEquipmentChanged({
        ...variation,
        currentSourceGymEquipmentTypeIds: [],
      }),
    ).toBe(true);
  });
});

describe("describeVariationSaveError", () => {
  const apiError = (
    over: Partial<Parameters<typeof describeVariationSaveError>[0]> = {},
  ) =>
    ({
      kind: "api" as const,
      code: "unknown" as const,
      message: "Request failed",
      ...over,
    }) as Parameters<typeof describeVariationSaveError>[0];

  /**
   * ⚠ DERIVED from `LOADOUT_ERROR_CODES`, never a hand-copied list. A literal
   * list cannot fail when a tenth code is added — which is the whole failure
   * mode here: seven codes reaching one generic string is what made Brad's
   * device report undiagnosable, and a test that has to be edited to notice an
   * eighth is not a guard. Excluding a code is a deliberate, named act.
   */
  const SAVE_CODES = LOADOUT_ERROR_CODES.filter(
    (code) =>
      !(CODES_NOT_EMITTED_BY_VARIATION_SAVE as readonly string[]).includes(
        code,
      ),
  );

  it.each(SAVE_CODES)(
    "gives %s its own copy, and never blames the network",
    (code) => {
      const copy = describeVariationSaveError(apiError({ loadoutCode: code }));
      expect(copy).not.toMatch(/connection/i);
      expect(copy.length).toBeGreaterThan(0);
      // The generic fallbacks are the thing being escaped, not an allowed answer.
      expect(copy).not.toMatch(/Try again in a moment/);
      expect(copy).not.toContain("Couldn't save this setup — ");
    },
  );

  it("gives every code a DISTINCT message", () => {
    const messages = SAVE_CODES.map((loadoutCode) =>
      describeVariationSaveError(apiError({ loadoutCode })),
    );
    // Collapsing two codes onto one string is how this drifted the first time.
    expect(new Set(messages).size).toBe(SAVE_CODES.length);
  });

  it("does not tell a failed CREATE that its saved setup is gone", () => {
    // Both endpoints answer 404 `not_found`, for different things. On create the
    // only 404 is an unreadable parent — a coach deleting an assigned workout
    // mid-review — and "save this as a new one" reissues the same failing call.
    const create = describeVariationSaveError(
      apiError({ loadoutCode: "not_found" }),
      false,
    );
    const replace = describeVariationSaveError(
      apiError({ loadoutCode: "not_found" }),
      true,
    );
    expect(create).not.toEqual(replace);
    expect(create).not.toMatch(/saved setup/i);
    expect(replace).toMatch(/saved setup/i);
  });

  it("blames the connection ONLY for a transport failure", () => {
    expect(describeVariationSaveError(apiError({ code: "network" }))).toMatch(
      /connection/i,
    );
    expect(describeVariationSaveError(apiError({ code: "timeout" }))).toMatch(
      /connection/i,
    );
    expect(
      describeVariationSaveError(apiError({ code: "server" })),
    ).not.toMatch(/connection/i);
  });

  it("surfaces the handler's own message when there is no code to map", () => {
    expect(
      describeVariationSaveError(
        apiError({ code: "unknown", message: "Variation name is required" }),
      ),
    ).toContain("Variation name is required");
  });

  it("does not surface the transport's placeholder message", () => {
    // `requestRaw` falls back to "Request failed", which tells the user nothing.
    expect(
      describeVariationSaveError(
        apiError({ code: "unknown", message: "Request failed" }),
      ),
    ).not.toContain("Request failed");
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

  it("returns neutral copy for an UNKNOWN code rather than crashing", () => {
    // `substitution_reason` is untyped jsonb and `user_override` is already
    // client-written, so a newer app version can hand an older one a fifth code.
    // Without a default the function returns undefined while typed
    // `LoadoutRowCopy`, and the first `.badge` read crashes the review screen.
    const copy = describeLoadoutRow(
      row({ reason: reason({ code: "some_future_code" as never }) }),
      EQUIPMENT_NAMES,
    );

    expect(copy.badge).toBe("CHANGED");
    expect(copy.explanation).toBe("This row was adapted.");
    expect(copy.tone).toBe("swapped");
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

    expect(
      rowsNeedingAttention(preview(rows), new Map()).map((r) => r.sortOrder),
    ).toEqual([1, 2]);
  });

  it("returns nothing for a fully clean plan", () => {
    expect(rowsNeedingAttention(preview([row()]), new Map())).toHaveLength(0);
  });

  it("treats a row with a MANUAL PICK as resolved", () => {
    // Both conditions are things the user resolves BY picking. Reading
    // `preview.rows` alone would leave the row flagged forever, and a container
    // gating Save on this being empty would deadlock with no way forward.
    const rows = [
      row({ sortOrder: 0, status: "unresolved", exerciseId: null }),
      row({ sortOrder: 1, reason: reason({ flags: ["intensity_mismatch"] }) }),
    ];
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: true }],
      [1, { exerciseId: "ex-8", isUserOverride: false }],
    ]);

    expect(rowsNeedingAttention(preview(rows), picks)).toHaveLength(0);
  });

  it("still flags rows the user has NOT picked for", () => {
    const rows = [
      row({ sortOrder: 0, status: "unresolved", exerciseId: null }),
      row({ sortOrder: 1, status: "unresolved", exerciseId: null }),
    ];
    const picks = new Map<number, ManualPick>([
      [0, { exerciseId: "ex-9", isUserOverride: true }],
    ]);

    expect(
      rowsNeedingAttention(preview(rows), picks).map((r) => r.sortOrder),
    ).toEqual([1]);
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

  it("DROPS an intensity_mismatch flag on a manual pick", () => {
    // The flag is computed against the SUBSTITUTE the engine chose, not the row.
    // Once the user picks something else it describes an exercise no longer in the
    // plan, and carrying it would persist durable misinformation into the
    // `substitution_reason` jsonb that AC-3.3 reads back to them later.
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
    expect(rows[0].substitutionReason?.flags).toEqual([]);
  });

  it("KEEPS the flag on a row the user did not touch", () => {
    const rows = buildVariationExercises(
      preview([
        row({
          reason: reason({
            code: "equipment_unavailable",
            flags: ["intensity_mismatch"],
          }),
        }),
      ]),
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

  it("does not cut a surrogate pair in half", () => {
    // `parentName` is attacker-influenceable (AC-1.2 + unbounded `workouts.name`),
    // and a lone high surrogate becomes U+FFFD in the saved name.
    const name = deriveVariationName("y".repeat(199) + "\uD83D\uDE00", null);

    expect(name).toHaveLength(199);
    expect(JSON.stringify(name)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("keeps a pair intact when it fits", () => {
    const name = deriveVariationName("y".repeat(198) + "\uD83D\uDE00", null);
    expect(name).toHaveLength(200);
    expect(name.endsWith("\uD83D\uDE00")).toBe(true);
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

  it("IGNORES a deselection of a server-injected detection", () => {
    // Enforced here as well as in the store: relying on `toggleScanDetection` alone
    // would make the guarantee depend on which store a caller uses, and unticking
    // `Bodyweight` makes every bodyweight exercise get swapped or dropped (T-E1.7).
    expect(
      scanDraftToEquipmentIds(draft, new Set(["eq-bw", DUMBBELL])),
    ).toEqual(["eq-bw"]);
  });

  it("allows every MODEL detection to be deselected", () => {
    expect(scanDraftToEquipmentIds(draft, new Set([DUMBBELL]))).toEqual([
      "eq-bw",
    ]);
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
