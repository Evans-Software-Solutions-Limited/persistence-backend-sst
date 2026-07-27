/**
 * Loadout (spec-21) — the client-side mirror of the Phase 0/1/3 backend contract.
 *
 * Loadout ADAPTS a workout the user already has to the equipment available today,
 * and saves the result as a VARIATION under the parent. The original is never
 * modified. It is not generate-from-scratch (that is a separate flow, design D2).
 *
 * ## Two rules this file exists to keep visible at the type level
 *
 * 1. **`SubstitutionReason` carries a CODE, not copy.** The backend deliberately
 *    emits no UI strings (`engine/reasons.ts`: "the code says *what* happened…")
 *    so the sentence is written and localised here. Anything that renders a row
 *    switches on `code` + `matchedOn`, never on server prose.
 * 2. **`note` is UNTRUSTED MODEL TEXT and must render as plain text only** — never
 *    markup, a link, or anything actionable. AC-1.2 makes a stranger's PUBLIC
 *    workout adaptable and neither `workouts.name` nor `exercises.name` is
 *    length-bounded, so an attacker can publish a workout whose exercise names
 *    instruct the model what to write. Same for the scan's `notes`/`label`, where
 *    the channel is a photograph the caller chose (a photographed whiteboard).
 *    The server caps both at 300 chars and strips unpaired surrogates; the render
 *    boundary is the rest of the control.
 *
 * Dates arrive as ISO strings over the wire even though the repository rows type
 * them as `Date` server-side.
 */

// ─── Saved gyms (§ 2.1, AC-2.1 / AC-7.2) ─────────────────────────────────────

/** A reusable equipment configuration: "Home garage", "PureGym Leeds". */
export type SavedGym = {
  readonly id: string;
  readonly name: string;
  readonly equipmentTypeIds: readonly string[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export type SavedGymInput = {
  readonly name: string;
  readonly equipmentTypeIds: readonly string[];
};

/**
 * `POST`/`PATCH /saved-gyms` answer **409 `SAVED_GYM_NAME_TAKEN`** on a duplicate
 * name (per user, compared on `lower(btrim(name))`) and **400
 * `UNKNOWN_EQUIPMENT_TYPE`** naming the offending ids. Both are recoverable in the
 * picker, so both are branchable — via `LoadoutApiError.loadoutCode`, whose
 * `LOADOUT_ERROR_CODES` list in `domain/ports/api.port.ts` is the SINGLE source of
 * truth for every Loadout wire code.
 *
 * ⚠ There is deliberately no per-endpoint code union here any more. Three of them
 * existed, none was the type of anything the adapter produced, and two carried
 * repository result statuses (`duplicate_name`) that the handlers never serialise —
 * so they read as a contract while documenting a fiction.
 */

// ─── Reasons (§ 7.2) ─────────────────────────────────────────────────────────

export type SubstitutionReasonCode =
  | "kept_compatible"
  | "equipment_unavailable"
  | "no_candidate"
  | "user_override";

/**
 * `intensity_mismatch` (AC-3.5b): the exercise choice is RIGHT and the
 * PRESCRIPTION is not — a 4–6 rep barbell hinge landed on bands.
 *
 * ⚠ The three offered actions are accept-as-accessory / swap manually / drop the
 * row. **Never "adjust the target".** Changing the prescription to suit the kit
 * relaxes design § 1 rule 2 (targets are a database property, never model output)
 * and is a Brad decision with its own slice.
 */
export type SubstitutionFlag = "intensity_mismatch";

/** Which § 6.2 signals the replacement matched on — the facts behind the copy. */
export type RankSignal =
  | "primary_muscles"
  | "secondary_muscles"
  | "difficulty"
  | "movement_type"
  | "category"
  | "logged_before";

/**
 * `ranker` means stage 3 repaired a model protocol failure. E2 measured zero such
 * repairs across 116 runs, so a non-trivial rate in production is a signal.
 */
export type RowSelectedBy = "model" | "ranker";

export type SubstitutionReason = {
  readonly code: SubstitutionReasonCode;
  /** `equipment_type` ids the source row needed and the kit lacks. */
  readonly missingEquipment: readonly string[];
  readonly matchedOn: readonly RankSignal[];
  readonly flags: readonly SubstitutionFlag[];
  /** ⚠ UNTRUSTED MODEL PROSE — plain text only. See the file docstring. */
  readonly note: string | null;
  readonly selectedBy: RowSelectedBy | null;
};

// ─── Preview (§ 7, AC-3.x) ───────────────────────────────────────────────────

export type LoadoutRowStatus = "kept" | "swapped" | "unresolved";

/** The display slice the preview and the swap picker both return per exercise. */
export type LoadoutExerciseDisplay = {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly difficultyLevel: string | null;
  readonly thumbnailUrl: string | null;
  readonly equipmentRequired: readonly string[];
};

/**
 * One row of the adapted plan.
 *
 * ⚠ **The targets are the PARENT's, carried across unchanged** (design § 1
 * rule 2). Nothing in the review step may edit them, and the save path re-sends
 * them verbatim.
 */
export type LoadoutPreviewRow = {
  readonly sortOrder: number;
  readonly status: LoadoutRowStatus;
  /** Null only when `status === "unresolved"`. */
  readonly exerciseId: string | null;
  /** Null on a kept row (AC-3.3 provenance). */
  readonly substitutedFromExerciseId: string | null;
  readonly reason: SubstitutionReason;
  /** Null when unresolved — there is no exercise to show. */
  readonly exercise: LoadoutExerciseDisplay | null;

  // Parent targets, unchanged.
  readonly supersetGroup: number | null;
  readonly targetSets: number | null;
  readonly targetRepsMin: number;
  readonly targetRepsMax: number;
  readonly targetDurationSeconds: number | null;
  readonly restSeconds: number | null;
  readonly notes: string | null;
};

export type LoadoutPreviewMeta = {
  readonly keptCount: number;
  readonly swappedCount: number;
  readonly unresolvedCount: number;
  readonly intensityMismatchCount: number;
  readonly candidateCount: number;
  /** True when the candidate pool hit its cap — never silent (§ 6.3). */
  readonly candidatePoolTruncated: boolean;
  /** Null when no row needed a swap, i.e. no model call was made. */
  readonly modelId: string | null;
};

export type LoadoutPreview = {
  readonly workoutId: string;
  readonly parentName: string;
  readonly savedGymId: string | null;
  readonly equipmentTypeIds: readonly string[];
  readonly rows: readonly LoadoutPreviewRow[];
  readonly meta: LoadoutPreviewMeta;
};

/**
 * `POST /workouts/:id/loadout/preview` takes **exactly one** of these. Sending
 * both, or neither, is a 400 `EQUIPMENT_CONTEXT_REQUIRED` — the two collect paths
 * (a saved gym vs manual/scanned ids) never produce both. Sending both keys with
 * the unused one `null` IS accepted, which is why the fields are nullable rather
 * than a discriminated union: it keeps the adapter's request body trivial.
 */
export type LoadoutPreviewInput = {
  readonly savedGymId?: string | null;
  readonly equipmentTypeIds?: readonly string[] | null;
};

// ─── Saving the reviewed plan (§ 7.1, AC-5.1) ────────────────────────────────

/**
 * One row on the way back to `POST /workouts/:id/variations`.
 *
 * ⚠ **Round-trip the preview's rows faithfully, `substitutionReason` included.**
 * The save path re-verifies exercise read-visibility on EVERY row (400
 * `EXERCISE_NOT_VISIBLE`) and equipment containment only on rows NOT flagged
 * `isUserOverride`.
 *
 * ⚠ **So a deliberate pick from the picker's incompatible list MUST set
 * `isUserOverride: true`**, or the save is rejected 400 `EQUIPMENT_NOT_AVAILABLE`
 * and the user loses a reviewed adaptation to an error they cannot act on.
 */
export type LoadoutVariationExerciseInput = {
  readonly exerciseId: string;
  readonly sortOrder: number;
  readonly supersetGroup?: number | null;
  readonly targetSets?: number | null;
  readonly targetRepsMin?: number;
  readonly targetRepsMax?: number;
  readonly targetDurationSeconds?: number | null;
  readonly restSeconds?: number | null;
  readonly notes?: string | null;
  readonly substitutedFromExerciseId?: string | null;
  readonly substitutionReason?: SubstitutionReason | null;
  readonly isUserOverride?: boolean;
};

export type CreateLoadoutVariationInput = {
  readonly name: string;
  readonly description?: string | null;
  readonly estimatedDurationMinutes?: number;
  readonly sourceGymId?: string | null;
  readonly sourceEquipmentTypeIds?: readonly string[];
  readonly exercises: readonly LoadoutVariationExerciseInput[];
};

/** A row of the parent's "Saved setups" list. */
export type WorkoutVariationSummary = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentWorkoutId: string | null;
  readonly variationKind: string | null;
  readonly sourceGymId: string | null;
  /** LEFT JOINed from `saved_gyms` — null when the gym was since deleted. */
  readonly sourceGymName: string | null;
  readonly sourceEquipmentTypeIds: readonly string[] | null;
  readonly estimatedDurationMinutes: number | null;
  readonly swapCount: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

// ─── Equipment-aware swap picker (§ 6.4, AC-4.2 / AC-4.4) ────────────────────

export type SubstituteCandidate = LoadoutExerciseDisplay & {
  readonly matchedOn: readonly RankSignal[];
};

/**
 * ⚠ **`best` and `others` are two different claims and must NOT be merged.**
 *
 * `best` is already containment-filtered and ranked — every entry is performable
 * with the supplied kit. `others` is the same muscle filter WITHOUT containment,
 * i.e. explicitly the INCOMPATIBLE list: render it dimmed and gate selection
 * behind an explicit acknowledgement that sets `isUserOverride: true`.
 *
 * `others` excludes every compatible id, not just the ones that fit `best`'s page,
 * so a performable exercise ranked past the limit never appears as "doesn't fit
 * your kit". Sorting the two together would destroy that distinction — rank order
 * alone cannot express "this one is illegal".
 *
 * With **no** equipment context, `best` is empty by design and everything arrives
 * in `others`. That is not an error: it is what lets one endpoint serve both the
 * Loadout review step (kit known) and the standalone in-session swap (kit may be
 * unknown).
 */
export type SubstitutesResult = {
  readonly best: readonly SubstituteCandidate[];
  readonly others: readonly SubstituteCandidate[];
  readonly meta: { readonly truncated: boolean };
};

export type SubstitutesQuery = {
  readonly forExerciseId: string;
  /** Omit entirely for the no-kit case. Never send `[]` expecting "no filter". */
  readonly equipment?: readonly string[];
  readonly limit?: number;
};

// ─── Equipment scan (§ 8, AC-2.3) ────────────────────────────────────────────

/**
 * A selectable row of the scan draft.
 *
 * `name` is the CATALOGUE's name, never the model's label, so nothing untrusted
 * reaches the selectable path. `source: "injected"` marks `Bodyweight`, which the
 * server adds rather than detecting (T-E1.7) — present it without implying the
 * camera saw it.
 */
export type EquipmentScanDetection = {
  readonly equipmentTypeId: string;
  readonly name: string;
  readonly confidence: number;
  readonly source: "model" | "injected";
};

/**
 * Something the model saw but could not match to the catalogue. Informational and
 * NOT selectable — there is no id to put in an equipment context. Showing these is
 * what stops a correctly-unmatched item reading as a miss.
 *
 * ⚠ `label` is untrusted model text — plain text only.
 */
export type EquipmentScanUnmatched = {
  readonly label: string;
  readonly confidence: number;
};

/**
 * The scan result is a DRAFT the user confirms (AC-2.3), and confirming it never
 * implicitly saves a gym. E1's 0.966 recall was measured on mostly-stock photos,
 * which are easy mode, so this is a head start on the picker — not a replacement
 * for it. AC-2.1 and AC-2.2 remain the floor (design § 1b).
 */
export type EquipmentScanDraft = {
  readonly detected: readonly EquipmentScanDetection[];
  readonly unmatched: readonly EquipmentScanUnmatched[];
  /** ⚠ UNTRUSTED MODEL PROSE — plain text only. */
  readonly notes: string | null;
  readonly modelId: string;
};

export type EquipmentScanInput = {
  readonly imageBase64: string;
  readonly mediaType: "image/jpeg" | "image/png";
};
