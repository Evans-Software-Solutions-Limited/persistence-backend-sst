/**
 * Shared shapes for the Loadout adaptation engine (spec-21 § 7).
 *
 * Kept in their own module so `adaptWorkout.ts` (the deterministic stages) and
 * `remapModel.ts` (stage 2's model adapter) can both depend on them without a
 * circular import.
 */

import type { AdaptationCandidate } from "../../repositories/exerciseRepository";
import type { SubstitutionReason } from "./reasons";

/**
 * The parent's training targets, which are carried across UNCHANGED — design § 1
 * rule 2: "programme structure is a database property, not a model property".
 * No model output ever reaches these fields; stage 3 asserts as much.
 */
export interface PlanTargets {
  supersetGroup: number | null;
  targetSets: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
}

/** One parent row, partitioned into KEPT / needs-swap by stage 1. */
export interface PlanRow extends PlanTargets {
  sortOrder: number;
  source: AdaptationCandidate;
  needsSwap: boolean;
  /**
   * `equipment_type` ids the source row needs and the context does not have.
   * Empty on a kept row; this is what the reason's `missingEquipment` reports.
   */
  missingEquipment: string[];
}

export type AdaptedRowStatus = "kept" | "swapped" | "unresolved";

/** One row of the adapted plan, as the preview returns it. */
export interface AdaptedRow extends PlanTargets {
  sortOrder: number;
  status: AdaptedRowStatus;
  /** Null only when `status === "unresolved"`. */
  exerciseId: string | null;
  /** The exercise this row replaced. Null on a kept row (AC-3.3 provenance). */
  substitutedFromExerciseId: string | null;
  reason: SubstitutionReason;
  /**
   * Display fields for the review step, so Phase 2 renders the plan without a
   * second round trip per row. Null when unresolved (there is no exercise).
   */
  exercise: {
    id: string;
    name: string;
    category: string | null;
    difficultyLevel: string | null;
    thumbnailUrl: string | null;
    equipmentRequired: string[];
  } | null;
}

export interface AdaptedPlanMeta {
  keptCount: number;
  swappedCount: number;
  unresolvedCount: number;
  /** Rows flagged `intensity_mismatch` (AC-3.5b). */
  intensityMismatchCount: number;
  /** Candidates that survived stage 1, before shortlisting. */
  candidateCount: number;
  /** True when `LIMIT 400` discarded rows (§ 6.3 — never silent). */
  candidatePoolTruncated: boolean;
  /** Null when no row needed a swap, i.e. no model call was made. */
  modelId: string | null;
}

export interface AdaptedPlan {
  rows: AdaptedRow[];
  meta: AdaptedPlanMeta;
}
