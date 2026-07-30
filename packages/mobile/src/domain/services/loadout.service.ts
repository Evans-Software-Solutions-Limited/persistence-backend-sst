/**
 * Loadout (spec-21) — the pure logic behind the athlete flow.
 *
 * Everything here is a pure function so it can be exhaustively tested without a
 * renderer, and three of them exist because the alternative is a container doing
 * something subtle and getting it wrong on a device:
 *
 * 1. **`describeLoadoutRow`** — the review step's copy. The backend deliberately
 *    emits NO UI strings (`engine/reasons.ts`), so the sentence is written HERE
 *    from the structured code plus `matchedOn`. The eval's arms both wrote English
 *    server-side and that is exactly what must not ship.
 * 2. **`buildVariationExercises`** — the round-trip back into
 *    `POST /workouts/:id/variations`. The save path re-verifies containment on
 *    every row NOT flagged `isUserOverride`, so a deliberate pick from the
 *    picker's incompatible list must carry that flag or the whole reviewed
 *    adaptation is lost to a 400 the user cannot act on.
 * 3. **`groupEquipmentForPicker`** — grouping driven by the API's `category`, not a
 *    hardcoded client list (AC-2.2), with an explicit "Other" bucket so an
 *    uncategorised row is still selectable rather than vanishing.
 */

import type {
  EquipmentScanDraft,
  LoadoutPreview,
  LoadoutPreviewRow,
  LoadoutVariationExerciseInput,
  RankSignal,
  SubstitutionReason,
  WorkoutVariationSummary,
} from "@/domain/models/loadout";
import type { ReferenceEntry } from "@/domain/models/reference-list";
import { capText } from "@/shared/utils";

// ─── Review-step copy (§ 7.2 — rendered FROM the code) ───────────────────────

/**
 * How a row's explanation should be weighted visually. Maps to the design's
 * KEPT (success) / SWAPPED (primary) / needs-attention (ember) treatments.
 */
export type LoadoutRowTone = "kept" | "swapped" | "attention";

export type LoadoutRowCopy = {
  /** The pill: "KEPT" / "SWAPPED" / "NO MATCH". */
  readonly badge: string;
  readonly tone: LoadoutRowTone;
  /** One line explaining the row. Never contains model prose. */
  readonly explanation: string;
  /**
   * The model's own sentence, or null.
   *
   * ⚠ **UNTRUSTED. Render as PLAIN TEXT ONLY** — never markup, never a link,
   * never anything actionable. Kept in its own field precisely so a caller cannot
   * accidentally concatenate it into `explanation` and lose track of which half is
   * ours and which half came from a model steered by an attacker-supplied workout
   * name. Empty/whitespace-only notes normalise to null so the UI never renders an
   * empty quote block.
   */
  readonly modelNote: string | null;
  /**
   * True when the exercise is right but the PRESCRIPTION is not (AC-3.5b).
   *
   * ⚠ The offered actions are accept-as-accessory / swap manually / drop the row.
   * **Never "adjust the target"** — that relaxes design § 1 rule 2 and is a Brad
   * decision with its own slice.
   */
  readonly intensityMismatch: boolean;
};

const SIGNAL_PHRASES: Record<RankSignal, string> = {
  primary_muscles: "same primary muscles",
  secondary_muscles: "similar supporting muscles",
  difficulty: "same difficulty",
  movement_type: "same movement pattern",
  category: "same exercise type",
  logged_before: "you've trained it before",
};

/**
 * Turn the ranker's signals into a phrase, in the order given.
 *
 * The backend returns these so the app can be SPECIFIC without inventing a claim —
 * "same primary muscles, you've trained it before" is checkable; "a great
 * alternative" is not. Capped at three so a row with every signal set does not
 * produce a sentence nobody reads.
 */
export function describeMatchSignals(
  matchedOn: readonly RankSignal[],
): string | null {
  const phrases = matchedOn
    .map((signal) => SIGNAL_PHRASES[signal])
    .filter((phrase): phrase is string => Boolean(phrase))
    .slice(0, 3);
  if (phrases.length === 0) return null;
  if (phrases.length === 1) return phrases[0] as string;
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

/**
 * Normalise the model's sentence for rendering: trim, and treat empty as absent.
 * Does NOT sanitise — the server already capped it at 300 chars and stripped
 * unpaired surrogates. The remaining control is that the caller renders it as
 * text, which is why it stays a separate field.
 */
function normaliseNote(note: string | null): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The review row's copy, derived from `reason.code`.
 *
 * `equipmentNameById` resolves the ids in `missingEquipment` to labels so the
 * explanation can name what is missing. An unresolved id is omitted rather than
 * rendered raw — a uuid in a sentence is worse than a vaguer sentence — and if
 * NOTHING resolves the copy falls back to a form that makes no equipment claim at
 * all, rather than saying "No  available".
 */
export function describeLoadoutRow(
  row: LoadoutPreviewRow,
  equipmentNameById: ReadonlyMap<string, string> = new Map(),
): LoadoutRowCopy {
  const { reason } = row;
  const modelNote = normaliseNote(reason.note);
  const intensityMismatch = reason.flags.includes("intensity_mismatch");

  const missingNames = reason.missingEquipment
    .map((id) => equipmentNameById.get(id))
    .filter((name): name is string => Boolean(name));
  const missingPhrase =
    missingNames.length > 0 ? missingNames.join(", ") : null;

  switch (reason.code) {
    case "kept_compatible":
      return {
        badge: "KEPT",
        tone: intensityMismatch ? "attention" : "kept",
        explanation: "Your kit covers this one — unchanged.",
        modelNote,
        intensityMismatch,
      };

    case "equipment_unavailable": {
      const signals = describeMatchSignals(reason.matchedOn);
      const lead = missingPhrase
        ? `No ${missingPhrase} available`
        : "Swapped for your kit";
      return {
        badge: "SWAPPED",
        tone: intensityMismatch ? "attention" : "swapped",
        explanation: signals ? `${lead} · ${signals}` : lead,
        modelNote,
        intensityMismatch,
      };
    }

    case "user_override":
      return {
        badge: "YOUR PICK",
        tone: "swapped",
        // Said plainly rather than hidden: the user chose this knowing it does not
        // fit, and the row's provenance records that. Pretending otherwise would
        // make the saved variation confusing to read back later (AC-3.3).
        explanation: "You chose this one.",
        modelNote,
        intensityMismatch,
      };

    case "no_candidate":
      return {
        badge: "NO MATCH",
        tone: "attention",
        explanation: missingPhrase
          ? `Nothing in your kit replaces this — needs ${missingPhrase}.`
          : "Nothing in your kit replaces this one.",
        modelNote,
        intensityMismatch,
      };

    default: {
      // Keeps BOTH guarantees: adding a fifth `SubstitutionReasonCode` is now a
      // compile error here (so the new case gets deliberate copy), while a code
      // arriving from persisted jsonb at RUNTIME still gets neutral copy instead of
      // crashing. Without the assignment the fallback would silently absorb a new
      // union member.
      const _exhaustive: never = reason.code;
      void _exhaustive;
      // ⚠ Unreachable against today's union, and NOT redundant. `reason` is read
      // back out of `workout_exercises.substitution_reason`, which is untyped
      // jsonb, and `user_override` is already a code the CLIENT writes — so a
      // variation saved by a newer app version can hand an older one a code this
      // switch has never seen. Without this branch the function returns
      // `undefined` while typed `LoadoutRowCopy`, and the first `.badge` read
      // crashes the review screen on a provenance display (AC-3.3). A neutral copy
      // makes the round trip version-tolerant.
      return {
        badge: "CHANGED",
        tone: "swapped",
        explanation: "This row was adapted.",
        modelNote,
        intensityMismatch,
      };
    }
  }
}

/**
 * Rows the user must act on before the plan is worth saving (AC-3.4 / AC-3.5b).
 *
 * ⚠ **Takes `manualPicks`, and must.** Both conditions are things the user resolves
 * BY picking a replacement, so reading `preview.rows` alone would leave a row in the
 * "needs attention" set no matter what they did — and any container gating Save on
 * this being empty would deadlock the flow with no way forward. A row with a
 * manual pick is resolved by definition: the user has seen it and chosen.
 */
export function rowsNeedingAttention(
  preview: LoadoutPreview,
  // REQUIRED, not defaulted. An optional parameter would let a future container
  // call `rowsNeedingAttention(preview)`, silently get the pre-fix behaviour and
  // deadlock its Save gate with no type error — which is the exact bug this
  // parameter was added to close. Pass an empty Map when there are no picks.
  manualPicks: ReadonlyMap<number, ManualPick>,
): readonly LoadoutPreviewRow[] {
  return preview.rows.filter((row) => {
    if (manualPicks.has(row.sortOrder)) return false;
    return (
      row.status === "unresolved" ||
      row.reason.flags.includes("intensity_mismatch")
    );
  });
}

// ─── Saving the reviewed plan (§ 7.1) ────────────────────────────────────────

/** A row the user replaced by hand in the review step. */
export type ManualPick = {
  readonly exerciseId: string;
  /**
   * True when the pick came from the picker's `others` (INCOMPATIBLE) list and the
   * user explicitly acknowledged it does not fit their kit.
   *
   * ⚠ This is the flag the save path keys on. It must be set from which LIST the
   * candidate came from, never inferred from the exercise's own equipment — a
   * client-side containment re-check would drift from the server's and either
   * reject a legal pick or, worse, mark a legal pick as an override and corrupt the
   * provenance the save path reads.
   */
  readonly isUserOverride: boolean;
};

/**
 * Build the `exercises` array for `POST /workouts/:id/variations` from a reviewed
 * preview plus any manual picks, keyed by `sortOrder`.
 *
 * ## What this function is protecting
 *
 * - **Targets round-trip verbatim.** They are the parent's (design § 1 rule 2) and
 *   nothing in the review step may alter them.
 * - **`substitutionReason` round-trips**, so the saved variation can explain itself
 *   later (AC-3.3). A manual pick gets a fresh `user_override` reason instead —
 *   keeping the model's original sentence would attribute the user's choice to the
 *   model.
 * - **`isUserOverride` is carried from the pick, not recomputed.** See `ManualPick`.
 * - **Unresolved rows with no manual pick are DROPPED**, not sent with a null
 *   `exerciseId`. The wire schema requires an `exerciseId`, so sending the row
 *   would be a 422; dropping it is the "drop the row" action AC-3.4 offers, and the
 *   caller is expected to have made the user confront those rows first (see
 *   `rowsNeedingAttention`).
 */
export function buildVariationExercises(
  preview: LoadoutPreview,
  manualPicks: ReadonlyMap<number, ManualPick> = new Map(),
): LoadoutVariationExerciseInput[] {
  const rows: LoadoutVariationExerciseInput[] = [];

  for (const row of preview.rows) {
    const pick = manualPicks.get(row.sortOrder);
    const exerciseId = pick?.exerciseId ?? row.exerciseId;
    if (exerciseId == null) continue;

    const reason: SubstitutionReason = pick
      ? {
          code: "user_override",
          // The kit gap is still a fact about the row, so it survives; the
          // ranker's `matchedOn` does not, because the ranker did not choose this.
          missingEquipment: row.reason.missingEquipment,
          matchedOn: [],
          // ⚠ `flags` is DROPPED, not carried. `intensity_mismatch` is not a fact
          // about the row — `adaptWorkout` computes it against the SUBSTITUTE it
          // chose (`hasIntensityMismatch(row, row.source, chosen)`). Once the user
          // picks something else, the flag describes an exercise no longer in the
          // plan, and carrying it would persist that into `substitution_reason`
          // jsonb as durable misinformation the AC-3.3 provenance read would
          // later show back to them.
          flags: [],
          note: null,
          selectedBy: null,
        }
      : row.reason;

    // The exercise this row REPLACED. On a manual pick over a kept row there is no
    // prior substitution, so the source is the row's own original exercise —
    // otherwise the provenance would read as though nothing changed.
    const substitutedFrom = pick
      ? (row.substitutedFromExerciseId ?? row.exerciseId ?? null)
      : row.substitutedFromExerciseId;

    rows.push({
      exerciseId,
      sortOrder: row.sortOrder,
      supersetGroup: row.supersetGroup,
      targetSets: row.targetSets,
      targetRepsMin: row.targetRepsMin,
      targetRepsMax: row.targetRepsMax,
      targetDurationSeconds: row.targetDurationSeconds,
      restSeconds: row.restSeconds,
      notes: row.notes,
      substitutedFromExerciseId:
        substitutedFrom === exerciseId ? null : substitutedFrom,
      substitutionReason: reason,
      ...(pick?.isUserOverride ? { isUserOverride: true } : {}),
    });
  }

  return rows;
}

/**
 * The default name for a saved variation: the parent plus where it is for.
 *
 * Capped at the endpoint's 200-char limit so a long parent name cannot make the
 * save fail validation on a field the user never typed in.
 */
/** `POST /workouts/:id/variations` caps `name` at 200 chars. */
export const MAX_VARIATION_NAME_LENGTH = 200;

export function deriveVariationName(
  parentName: string,
  gymName: string | null,
): string {
  const base = gymName ? `${parentName} · ${gymName}` : parentName;
  // Cut on a whole CODE POINT, not a code unit. `parentName` is
  // attacker-influenceable — AC-1.2 makes a stranger's PUBLIC workout adaptable and
  // `workouts.name` is unbounded at its create handler — so a 199-char name followed
  // by an emoji would otherwise leave a lone high surrogate, which the driver
  // replaces with U+FFFD in the saved variation's name. `capModelProse` exists for
  // exactly this hazard; reusing it keeps one implementation of the rule.
  return capText(base, MAX_VARIATION_NAME_LENGTH);
}

/**
 * True only when a still-linked saved gym has a different equipment SET from
 * the frozen snapshot used for this adaptation. Order and duplicates are not
 * meaningful, and a rename-only update must not make the workout look stale.
 */
export function hasGymEquipmentChanged(
  variation: Pick<
    WorkoutVariationSummary,
    | "sourceGymId"
    | "sourceEquipmentTypeIds"
    | "currentSourceGymEquipmentTypeIds"
  >,
): boolean {
  if (
    variation.sourceGymId == null ||
    variation.sourceEquipmentTypeIds == null ||
    variation.currentSourceGymEquipmentTypeIds == null
  ) {
    return false;
  }
  const frozen = new Set(variation.sourceEquipmentTypeIds);
  const current = new Set(variation.currentSourceGymEquipmentTypeIds);
  if (frozen.size !== current.size) return true;
  for (const id of frozen) {
    if (!current.has(id)) return true;
  }
  return false;
}

// ─── Equipment picker (AC-2.2 — grouped from the API) ────────────────────────

export type EquipmentPickerGroup = {
  readonly category: string;
  readonly label: string;
  readonly items: readonly ReferenceEntry[];
};

/** Display order and copy for the six seeded categories (migration 20260726120300). */
const CATEGORY_LABELS: readonly (readonly [string, string])[] = [
  ["free_weights", "Free weights"],
  ["machines", "Machines"],
  ["cables", "Cables"],
  ["bodyweight", "Bodyweight"],
  ["cardio", "Cardio"],
  ["accessories", "Accessories"],
];

/** The bucket for a row whose `category` is null or unrecognised. */
export const EQUIPMENT_OTHER_CATEGORY = "other";

/**
 * Group the equipment catalogue for the manual picker.
 *
 * Driven by the API's `category` rather than a hardcoded client list (AC-2.2), so
 * seeding a new equipment type needs no app release. Two deliberate behaviours:
 *
 * - **Groups keep a fixed display order**, not the catalogue's, so the picker does
 *   not reshuffle when a row is added.
 * - **An uncategorised or unknown-category row lands in "Other" and stays
 *   selectable.** Dropping it would make a real piece of equipment unreachable —
 *   and silently, which is the failure mode T-E.10 already demonstrated for
 *   unmapped equipment names.
 */
export function groupEquipmentForPicker(
  entries: readonly ReferenceEntry[],
): EquipmentPickerGroup[] {
  const byCategory = new Map<string, ReferenceEntry[]>();
  const known = new Set(CATEGORY_LABELS.map(([category]) => category));

  for (const entry of entries) {
    const raw = entry.category;
    const category =
      raw != null && known.has(raw) ? raw : EQUIPMENT_OTHER_CATEGORY;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }

  const groups: EquipmentPickerGroup[] = [];
  for (const [category, label] of CATEGORY_LABELS) {
    const items = byCategory.get(category);
    if (items && items.length > 0) groups.push({ category, label, items });
  }
  const other = byCategory.get(EQUIPMENT_OTHER_CATEGORY);
  if (other && other.length > 0) {
    groups.push({
      category: EQUIPMENT_OTHER_CATEGORY,
      label: "Other",
      items: other,
    });
  }
  return groups;
}

/**
 * The equipment ids a confirmed scan draft contributes.
 *
 * Only `detected` — `unmatched` rows have no catalogue id by definition, so there
 * is nothing to select. `deselectedIds` lets the confirm step honour the user
 * unticking a false positive, which is the whole point of the draft being a draft
 * (AC-2.3): E1's recall was measured on mostly-stock photos and is a ceiling, not
 * a real-world rate.
 */
export function scanDraftToEquipmentIds(
  draft: EquipmentScanDraft,
  deselectedIds: ReadonlySet<string> = new Set(),
): string[] {
  return draft.detected
    .filter(
      (detection) =>
        // ⚠ A server-INJECTED detection is never dropped, whatever the caller's
        // deselection set says. `useLoadoutFlow.toggleScanDetection` refuses to add
        // one, but enforcing it ONLY there would leave the guarantee dependent on
        // which store a caller happens to use — and unticking `Bodyweight` makes
        // every bodyweight exercise get swapped or dropped for no reason (T-E1.7).
        detection.source === "injected" ||
        !deselectedIds.has(detection.equipmentTypeId),
    )
    .map((detection) => detection.equipmentTypeId);
}
