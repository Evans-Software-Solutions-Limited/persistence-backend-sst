/**
 * Loadout reason codes (spec-21 § 7.2, T-1.5 / T-1.10).
 *
 * **Structured, and free of UI copy.** The backend emits a code plus the facts
 * behind it; the mobile layer renders the sentence. That keeps copy localisable
 * and stops product copy accreting in `microservices/core` — the eval's arms
 * both wrote English here ("Kept · your kit has dumbbells") and that is exactly
 * what must not ship.
 *
 * One field is an exception and is deliberate: `note` carries the MODEL's
 * sentence verbatim. E2 (`VERDICT-E2.md` § What Phase 1 inherits) found that
 * § 7.2's codes alone are no longer sufficient once a model writes the copy —
 * the code says *what* happened, the note says *why this alternative*, which no
 * enum can express. It is model output passed through, not backend copy, and
 * Phase 2 owns whether and how it is shown.
 *
 * The whole object is persisted as `workout_exercises.substitution_reason`
 * (jsonb) when the reviewed plan is saved, so a variation can explain itself
 * later (AC-3.3).
 */

/** design § 7.2's four codes. */
export type SubstitutionReasonCode =
  | "kept_compatible"
  | "equipment_unavailable"
  | "no_candidate"
  | "user_override";

/**
 * Advisory flags on a row that is otherwise fine. Surfaced through the same
 * review-step machinery as AC-3.4's unresolved rows.
 *
 * `intensity_mismatch` (AC-3.5b, § 7.1b): the exercise choice is correct and the
 * PRESCRIPTION is still unusable — a 4-6 rep barbell hinge landing on bands.
 */
export type SubstitutionFlag = "intensity_mismatch";

/**
 * Which § 6.2 signals the chosen alternative matched on. Returned so the review
 * step can be specific ("same primary muscles, you've trained it before")
 * without the backend writing that sentence.
 */
export type RankSignal =
  | "primary_muscles"
  | "secondary_muscles"
  | "difficulty"
  | "movement_type"
  | "category"
  | "logged_before";

/**
 * How the row's exercise was chosen. `model` is the shipping path (D7's hybrid);
 * `ranker` means stage 3 repaired a protocol failure — the model named an
 * exercise already used elsewhere in the plan, or skipped the row entirely — by
 * falling back to the best unused shortlist entry.
 *
 * Recorded rather than hidden because the rate is worth watching: E2 measured
 * zero duplicate picks across 116 model runs, so a non-trivial `ranker` rate in
 * production means something changed.
 */
export type RowSelectedBy = "model" | "ranker";

export interface SubstitutionReason {
  code: SubstitutionReasonCode;
  /**
   * `equipment_type` ids the source row required that the kit does not have.
   * Populated on a swap or an unresolved row; empty on a kept row.
   */
  missingEquipment: string[];
  /** Empty unless a replacement was chosen. */
  matchedOn: RankSignal[];
  flags: SubstitutionFlag[];
  /** The model's one-sentence rationale, or null when no model wrote this row. */
  note: string | null;
  selectedBy: RowSelectedBy | null;
}

/**
 * Every reason object is built through one of these so a new field can never be
 * half-populated across the four code paths.
 */
export function keptReason(): SubstitutionReason {
  return {
    code: "kept_compatible",
    missingEquipment: [],
    matchedOn: [],
    flags: [],
    note: null,
    selectedBy: null,
  };
}

export function swappedReason(input: {
  missingEquipment: string[];
  matchedOn: RankSignal[];
  flags: SubstitutionFlag[];
  note: string | null;
  selectedBy: RowSelectedBy;
}): SubstitutionReason {
  return {
    code: "equipment_unavailable",
    missingEquipment: input.missingEquipment,
    matchedOn: input.matchedOn,
    flags: input.flags,
    note: input.note,
    selectedBy: input.selectedBy,
  };
}

export function unresolvedReason(input: {
  missingEquipment: string[];
  note: string | null;
}): SubstitutionReason {
  return {
    code: "no_candidate",
    missingEquipment: input.missingEquipment,
    matchedOn: [],
    flags: [],
    note: input.note,
    selectedBy: null,
  };
}
