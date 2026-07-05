/**
 * Entitlement feature enum for M10.5 feature gates.
 *
 * Mirrors the backend's `EntitlementFeature` union in
 * `microservices/core/src/application/entitlement/assertEntitlement.ts`.
 * Both definitions MUST stay in sync — if backend adds a feature, mobile
 * mirrors. Known tech-debt (parallel to the reconcile-helpers duplication
 * called out in `specs/11-payments-subscriptions/design.md` § Database /
 * Trigger contract reminder).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 *       · Server-side `assertEntitlement` helper
 * Satisfies: requirements.md AC 10.1
 *
 * `create_workout` and `ai_access` (M9.5) are enforced server-side with a
 * REAL check. The remaining four are stubs today — `assertEntitlement`
 * returns `{ allowed: true }` pending real endpoints (`ai_workout` for the
 * AI workout generator — a distinct, still-unshipped feature from
 * `ai_access`'s nutrition AI estimation, `gym_buddy` for the social-buddy
 * module, `trainer_clients` for M8 trainer routes,
 * `unlimited_exercise_library` for a future schema flag). The mobile
 * client-side `useFeatureGate` mirrors that stub-allow behaviour so the
 * two layers agree.
 *
 * `ai_access` (specs/13-nutrition-tracking/design.md § Revised 2026-07-03)
 * gates the M9.5 Tier B nutrition AI photo/free-text estimation endpoints
 * (`POST /nutrition/ai/estimate`, `/nutrition/ai/estimate-text`). Rule:
 * `paymentStatus IN ('active','trialing')` AND `tier.aiAccess === true` —
 * see `useFeatureGate`'s `computeFeatureGateVerdict`.
 */
export type EntitlementFeature =
  | "create_workout"
  | "ai_workout"
  | "ai_access"
  | "gym_buddy"
  | "unlimited_exercise_library"
  | "trainer_clients";
