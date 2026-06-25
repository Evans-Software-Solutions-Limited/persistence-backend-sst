import { useFeatureGate, type FeatureGateResult } from "./useFeatureGate";

/**
 * Tier-B (Snap / AI auto-estimate) lock for M9. These surfaces render LOCKED;
 * tapping routes to the upgrade prompt. M9 reuses the existing `ai_workout`
 * feature gate as the placeholder — there is no AI nutrition write path in M9,
 * and the dedicated `aiAccess` nutrition key is reconciled in M9.5 (Conflict
 * C6). Consume `allowed`/`gateProps`; do NOT wire any AI call behind it.
 */
export function useNutritionAiGate(): FeatureGateResult {
  return useFeatureGate("ai_workout");
}
