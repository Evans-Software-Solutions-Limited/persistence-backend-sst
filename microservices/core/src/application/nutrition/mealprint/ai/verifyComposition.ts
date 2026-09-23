/**
 * Mealprint (spec-26 design § 1 stage 3) — VERIFICATION.
 *
 * The stage that makes the whole design safe. It takes the model's selections and:
 *
 *   1. re-resolves every `candidateId` against the candidate list the server
 *      built, and recomputes EVERY macro from those rows;
 *   2. re-runs `avoidanceFilter` over every resolved item (defence in depth — the
 *      model is an untrusted composer, so a violation must not reach the user
 *      even if the pool that produced it was correct);
 *   3. checks the result against the remaining budget within tolerance.
 *
 * Pure and synchronous, like `avoidanceFilter`: the candidate list is passed in,
 * so every branch is enumerable in tests.
 *
 * ⚠ **A failing suggestion is DROPPED, never repaired and never silently
 * included** (AC 4.6 for plans; for suggestions the spec says "dropped"). The
 * distinction matters: substituting a different food to rescue a suggestion would
 * mean shipping something the model did not compose and the user's reason line no
 * longer describes.
 */

import {
  assessAvoidance,
  hasPartialEnforcementPattern,
  type AvoidancePreferences,
} from "../safety/avoidanceFilter";
import type { MealprintCandidate } from "../../../repositories/mealprintCandidateRepository";
import type { ModelSuggestion, RemainingBudget } from "./suggestModel";
import { hasGrossMacroEnergyMismatch } from "../../services/offEnergy";
import { assessCompositionPortion } from "./portionPolicy";

/**
 * Tolerance for a suggestion (design § 1 stage 3): it must fit the remaining
 * budget without exceeding kcal by more than 5 %.
 *
 * ⚠ Asymmetric on purpose. Overshooting calories is the failure a user
 * experiences as the feature being wrong ("you told me this fit"); undershooting
 * is merely a smaller snack, which is fine and often correct — there is no floor
 * on how little of the remaining budget a suggestion may use.
 */
export const KCAL_OVERSHOOT_TOLERANCE = 0.05;

/**
 * Absolute kcal floor for the overshoot check.
 *
 * ⚠ Without it the percentage rule is meaningless at the end of a day: with 40
 * kcal left, 5 % is 2 kcal, so every real food fails and the user gets "no
 * suggestions" rather than "you have essentially nothing left". The floor makes
 * a nearly-exhausted budget produce an honest empty result for a stated reason
 * instead of a tolerance artefact.
 */
export const MIN_USEFUL_REMAINING_KCAL = 100;

export type VerificationFailure =
  /** An id the model returned is not in the candidate list. */
  | "non_member_candidate"
  /** A resolved item violates an avoidance — the model composed something unsafe. */
  | "avoidance_violation"
  /** The recomputed total exceeds the remaining calories beyond tolerance. */
  | "kcal_overshoot"
  /** An item or whole plate exceeds the server-derived portion policy. */
  | "implausible_portion"
  /** Every item resolved to a zero/negative macro row — nothing to show. */
  | "degenerate_macros";

export interface VerifiedItem {
  candidateId: string;
  kind: MealprintCandidate["kind"];
  name: string;
  servings: number;
  servingLabel: string;
  /** Recomputed from the DB row × servings. Never from the model. */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** TRUE when this item's allergen content is UNKNOWN (AC 2.2 flag). */
  unverified: boolean;
}

export interface VerifiedSuggestion {
  name: string;
  reason: string;
  items: VerifiedItem[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /**
   * TRUE when ANY item's allergen content is unknown, OR the suggestion is an
   * `eating_out` "best order" card (amendment § A.3 decision 2 — forced TRUE
   * regardless of the resolved items, because there is no restaurant-menu
   * dataset to verify against). Drives the inline label-check disclaimer
   * (AC 3.4).
   */
  containsUnverified: boolean;
  /** TRUE when an active pattern cannot be fully enforced (halal/kosher). */
  partialEnforcementOnly: boolean;
  /** TRUE for both `cheat_meal` cards. Carried through from the model suggestion. */
  cheat: boolean;
  /** TRUE for every `eating_out` "best order" card. */
  isOrder: boolean;
  /** `"Have it"` / `"Smart swap"` / `"Meal"` / `"Snack"`, or `null` for `on_plan`. */
  tag: string | null;
}

export interface VerificationResult {
  suggestions: VerifiedSuggestion[];
  /** Every rejection, with its cause — never silently dropped. */
  rejected: Array<{
    name: string;
    failure: VerificationFailure;
    detail: string;
  }>;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Verify a batch of model suggestions against the candidate list and budget.
 *
 * `candidates` MUST be the exact list handed to the model. Passing a wider pool
 * would let a food that stage 1 filtered out back in through the model's
 * selection — the one way the two deterministic passes could be made to disagree.
 */
export function verifySuggestions(input: {
  suggestions: readonly ModelSuggestion[];
  candidates: readonly MealprintCandidate[];
  remaining: RemainingBudget;
  preferences: AvoidancePreferences;
  maxMealKcal?: number;
  maxCheatMealKcal?: number;
}): VerificationResult {
  const byId = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );

  const kcalCeiling = Math.max(
    input.remaining.kcal * (1 + KCAL_OVERSHOOT_TOLERANCE),
    MIN_USEFUL_REMAINING_KCAL,
  );

  const suggestions: VerifiedSuggestion[] = [];
  const rejected: VerificationResult["rejected"] = [];

  // A property of the ACTIVE PATTERNS, not of any one suggestion — so it is
  // computed once. Carried on every suggestion anyway because the disclaimer it
  // drives is rendered per card (AC 3.4), and a caller reading one suggestion in
  // isolation must not have to re-derive it from the preferences.
  const partialEnforcementOnly = hasPartialEnforcementPattern(
    input.preferences,
  );

  for (const suggestion of input.suggestions) {
    const items: VerifiedItem[] = [];
    let failure: { failure: VerificationFailure; detail: string } | null = null;

    for (const item of suggestion.items) {
      const candidate = byId.get(item.candidateId);
      if (!candidate) {
        // Defence in depth: `composeSuggestions` already throws on a non-member
        // id. This branch catches a caller that verified against the wrong list —
        // a mistake that would otherwise be invisible and unsafe.
        failure = {
          failure: "non_member_candidate",
          detail: item.candidateId,
        };
        break;
      }

      // Independent fail-closed guard. Repository filtering is the primary
      // trust boundary, but a stale/injected candidate must still not reach a
      // user with impossible energy values.
      if (
        hasGrossMacroEnergyMismatch(candidate.kcal, {
          proteinG: candidate.proteinG,
          carbsG: candidate.carbsG,
          fatG: candidate.fatG,
        })
      ) {
        failure = {
          failure: "degenerate_macros",
          detail: `candidate=${candidate.id}:kcal=${candidate.kcal}`,
        };
        break;
      }

      // ⚠ RE-RUN THE AVOIDANCE FILTER. Stage 1 built the pool, but the model is
      // untrusted and this is the pass that holds if stage 1 was ever wrong —
      // a wrong locale, a stale preference read, a future caller that forgot to
      // filter. It is cheap and it is the reason the design can claim allergen
      // safety is enforced twice.
      const verdict = assessAvoidance(candidate, input.preferences);
      if (!verdict.allowed) {
        failure = {
          failure: "avoidance_violation",
          detail: `${verdict.rule}:${verdict.cause}`,
        };
        break;
      }

      items.push({
        candidateId: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
        servings: item.servings,
        servingLabel: candidate.servingLabel,
        // EVERY number from the DB row, scaled by the servings multiplier.
        kcal: round1(candidate.kcal * item.servings),
        proteinG: round1(candidate.proteinG * item.servings),
        carbsG: round1(candidate.carbsG * item.servings),
        fatG: round1(candidate.fatG * item.servings),
        unverified: verdict.unverified,
      });
    }

    if (failure !== null) {
      rejected.push({ name: suggestion.name, ...failure });
      continue;
    }

    const portionFailure = assessCompositionPortion({
      items: suggestion.items,
      candidates: byId,
      kcalCeiling:
        suggestion.cheat === true && suggestion.tag === "Have it"
          ? (input.maxCheatMealKcal ?? Number.POSITIVE_INFINITY)
          : (input.maxMealKcal ?? Number.POSITIVE_INFINITY),
    });
    if (portionFailure) {
      rejected.push({
        name: suggestion.name,
        failure: "implausible_portion",
        detail: portionFailure.detail,
      });
      continue;
    }

    const totals = items.reduce(
      (acc, item) => ({
        kcal: acc.kcal + item.kcal,
        proteinG: acc.proteinG + item.proteinG,
        carbsG: acc.carbsG + item.carbsG,
        fatG: acc.fatG + item.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );

    if (totals.kcal <= 0) {
      rejected.push({
        name: suggestion.name,
        failure: "degenerate_macros",
        detail: `kcal=${totals.kcal}`,
      });
      continue;
    }

    // ⚠ Amendment § A.3 decision 1: the cheat-meal "Have it" card is intentionally
    // allowed to exceed the remaining calories — that is the whole point of the
    // card. `cheat`/`tag` are resolved deterministically from the occasion in
    // `suggestModel.resolveOccasionFields`, never trusted verbatim from the
    // model, so this exemption cannot be forged by an `on_plan` response. The
    // "Smart swap" cheat card (`tag !== "Have it"`) still respects the ceiling,
    // as does every other occasion.
    const exemptFromKcalCeiling =
      suggestion.cheat === true && suggestion.tag === "Have it";
    if (!exemptFromKcalCeiling && totals.kcal > kcalCeiling) {
      rejected.push({
        name: suggestion.name,
        failure: "kcal_overshoot",
        detail: `${Math.round(totals.kcal)}>${Math.round(kcalCeiling)}`,
      });
      continue;
    }

    // ⚠ Amendment § A.3 decision 2: `eating_out` cards are forced unverified
    // regardless of what the resolved items say, because there is no
    // restaurant-menu dataset to check them against. `labelCheckRequired` in the
    // handler response is ALREADY unconditionally true for every occasion (see
    // its doc comment there), so this is the one additional flag decision 2
    // needs — it does not (and structurally cannot) weaken that existing
    // disclaimer.
    const containsUnverified =
      suggestion.isOrder === true || items.some((item) => item.unverified);

    suggestions.push({
      name: suggestion.name,
      reason: suggestion.reason,
      items,
      kcal: round1(totals.kcal),
      proteinG: round1(totals.proteinG),
      carbsG: round1(totals.carbsG),
      fatG: round1(totals.fatG),
      containsUnverified,
      partialEnforcementOnly,
      cheat: suggestion.cheat === true,
      isOrder: suggestion.isOrder === true,
      tag: typeof suggestion.tag === "string" ? suggestion.tag : null,
    });
  }

  return { suggestions, rejected };
}

/**
 * One line summarising a verification, for the handler's log.
 *
 * ⚠ `avoidance_violation` appearing here at all is a signal worth acting on: it
 * means the model selected something stage 1 should not have offered, i.e. the two
 * passes disagreed. That is a bug in candidate assembly, not a model quirk, and it
 * is invisible without this line because the user just sees one fewer suggestion.
 */
export function describeVerification(result: VerificationResult): string {
  const failures = result.rejected
    .map((entry) => entry.failure)
    .reduce<Record<string, number>>((acc, failure) => {
      acc[failure] = (acc[failure] ?? 0) + 1;
      return acc;
    }, {});
  const parts = Object.entries(failures).map(([k, v]) => `${k}=${v}`);
  return [
    `verified=${result.suggestions.length}`,
    parts.length > 0 ? parts.join(" ") : "rejected=0",
  ].join(" ");
}
