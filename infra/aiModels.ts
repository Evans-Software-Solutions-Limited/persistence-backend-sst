/**
 * Bedrock model ids — the SINGLE SOURCE OF TRUTH for what gets deployed.
 *
 * Why this file exists (2026-07-26 incident): the ids used to live only inline
 * in `api.ts`'s environment block, and the deploy-time preflight had nothing
 * authoritative to check against. Now `api.ts` spreads this object into the
 * Lambda environment and `scripts/check-bedrock-access.ts` imports the same
 * object, so **the preflight verifies exactly the ids that will be deployed** —
 * it cannot drift from reality, which is the only property that makes a
 * preflight trustworthy.
 *
 * ## The incident this is designed to catch
 *
 * `AI_TEXT_MODEL_ID` (Haiku 4.5) was never granted in the PRODUCTION Bedrock
 * account, though it was granted in Development. Free-text meal estimation and
 * the coach AI client summary therefore returned 503 on every production
 * request for 30 days while working perfectly in staging. Nothing detected it:
 * Bedrock's `AccessDeniedException` is a 403, which `isRetryable` correctly
 * declines to retry, so it became `AiUnavailableError` → a 503 response body →
 * and because the handler RETURNS rather than throws, `coreErrorHandler` never
 * logged it. The failure was invisible on the server and mislabelled on the
 * client.
 *
 * Model access is per-account AND per-model, so staging being healthy says
 * nothing about production. That asymmetry is the whole reason this needs to be
 * a deploy gate rather than a code review item.
 *
 * ## Adding or changing a model
 *
 * Change it here only. Then run the preflight against the target account
 * BEFORE merging, because a model that is not granted will fail the deploy:
 *
 *   bun run --cwd scripts check-bedrock-access
 *
 * ⚠ The runtime services each carry a `process.env.X ?? "<literal>"` fallback
 * (`nutrition/services/aiEstimation.ts`, `nutrition/services/recipeExtraction.ts`,
 * `trainers/services/clientSummaryAi.ts`). Those exist so a unit test or a local
 * run without env works; the deployed Lambda always has the env var set, so THIS
 * file wins in every real environment. If you change an id here, update those
 * fallbacks too or a local run will silently exercise a different model.
 *
 * ⚠ `eu.` prefixed ids are cross-region INFERENCE PROFILES, not foundation
 * models — they route to the underlying `anthropic.*` model across several EU
 * regions, which is why `api.ts` grants IAM on both ARN shapes. Do NOT switch
 * to a `global.` profile to work around a missing grant: it routes outside the
 * EU and would put health-adjacent data beyond what the DPIA commits to
 * (`specs/28-coach-data-sharing-consent/DPIA.md`).
 */

/**
 * Env var → Bedrock model id. Spread into the core API Lambda's environment by
 * `api.ts` and read verbatim by the preflight.
 */
export const AI_MODEL_IDS = {
  /** Snap AI photo estimation (`POST /nutrition/ai/estimate`). */
  AI_PHOTO_MODEL_ID: "eu.anthropic.claude-opus-4-6-v1",
  /**
   * THREE endpoints run on this one id, so a missing grant breaks all three:
   *   - `POST /nutrition/ai/estimate-text`     (free-text meal estimation)
   *   - `POST /nutrition/ai/resolve-ingredient`(recipeExtraction FOOD_MACROS_MODEL_ID)
   *   - `POST /nutrition/ai/estimate-recipe`   (same FOOD_MACROS_MODEL_ID)
   * …and `AI_COACH_SUMMARY_MODEL_ID` below resolves to the same model, making it
   * four endpoints in practice. That fan-out is why the preflight names every
   * env var referencing an id rather than just the first.
   */
  AI_TEXT_MODEL_ID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  /** Recipe photo extraction (`POST /nutrition/ai/extract-recipe`). */
  AI_RECIPE_MODEL_ID: "eu.anthropic.claude-opus-4-6-v1",
  /** Coach AI client summary (`POST /trainers/me/clients/:id/ai-summary`). */
  AI_COACH_SUMMARY_MODEL_ID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
} as const;

export type AiModelEnvVar = keyof typeof AI_MODEL_IDS;

/**
 * The distinct model ids, each with the env vars that reference it. Deduped
 * because two env vars share one id today — checking a model twice would double
 * the (already trivial) preflight cost and report the same failure twice, while
 * naming every affected env var is what makes a failure actionable.
 */
export function distinctAiModelIds(
  models: Record<string, string> = AI_MODEL_IDS,
): Array<{ modelId: string; envVars: string[] }> {
  const byModel = new Map<string, string[]>();
  for (const [envVar, modelId] of Object.entries(models)) {
    byModel.set(modelId, [...(byModel.get(modelId) ?? []), envVar]);
  }
  return [...byModel.entries()]
    .map(([modelId, envVars]) => ({ modelId, envVars }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId));
}
