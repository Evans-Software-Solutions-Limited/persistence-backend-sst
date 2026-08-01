import { useFeatureGate, type FeatureGateResult } from "./useFeatureGate";

/**
 * Tier-B (Snap / AI auto-estimate) gate — M9.5, LIVE. Gates the
 * `POST /nutrition/ai/estimate` (photo) and `/nutrition/ai/estimate-text`
 * (free-text) flows behind the real `ai_access` feature key (server-enforced
 * per specs/13-nutrition-tracking/design.md § Revised 2026-07-03; closes
 * Conflict C6 — `ai_access` replaces the M9 `ai_workout` placeholder used
 * before the AI endpoints shipped). `allowed === false` → render the
 * upgrade prompt via `gateProps`; `allowed === true` → the Snap sheet /
 * "Or describe it…" CTA are reachable.
 *
 * `enabled` (default `true`) forwards to `useFeatureGate`, which gates only
 * its `useMySubscription` call — the always-mounted QuickAdd/AddRecipe
 * sheets pass their own open state so `/subscriptions/me` waits for a real
 * open. `/subscription-tiers` stays UNGATED (see the comment on
 * `useFeatureGate`) — reverted after an Inspector Brad finding: it's cheap
 * and user-invariant, and gating it left the upgrade prompt's price missing
 * until the sheet's own round trip landed.
 */
export function useNutritionAiGate(enabled = true): FeatureGateResult {
  return useFeatureGate("ai_access", enabled);
}
