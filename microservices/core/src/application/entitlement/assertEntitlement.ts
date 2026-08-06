import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  profiles,
  ptClientRelationships,
  subscriptionTiers,
  userSubscriptions,
  workouts,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Server-side entitlement enforcement for premium-gated mutations.
 *
 * The single hot path that determines, from live DB state, whether a
 * user is allowed to perform a feature. JWT claims are intentionally NOT
 * consulted — the whole reason this layer exists is to defend the
 * "valid token, cancelled sub" abuse vector. Callers either get a
 * `{ allowed: true }` verdict (and proceed), or they throw the
 * `EntitlementError` so the shared Elysia error handler maps it to
 * HTTP 402 with a structured body the mobile gate prompt can render.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Entitlement enforcement (M10.5)
 *       specs/11-payments-subscriptions/requirements.md STORY-009 (AC 9.1–9.7)
 *       specs/milestones/M10-5-entitlement-hardening/BACKEND_BRIEF.md § 1
 *
 * Critical contract: this helper is READ-ONLY against
 *   - profiles
 *   - user_subscriptions
 *   - subscription_tiers
 *   - subscription_limits
 *
 * It MUST NOT write to `profiles.subscription_id`, `profiles.role`, or
 * any `subscription_limits.*` column — those are maintained by the
 * `update_subscription_limits_trigger` (see
 * `supabase/migrations/004_subscriptions_and_roles.sql` line 438+) and
 * the per-table workout/AI increment triggers. Writing from here would
 * race the trigger and corrupt the derived state.
 *
 * Free tier = 3 workouts TOTAL, not per month (Brad, locked product
 * decision — see `evaluateWorkoutTotalCapLock` below). The workout-count
 * comparison is therefore a live `COUNT(*) FROM workouts WHERE
 * created_by = userId` — the same query `workoutRepository.getQuota()`
 * runs for the mobile "N of 3 workouts" display — NOT
 * `subscription_limits.current_count` (that column is a MONTHLY
 * counter the `increment_usage_limit` trigger resets on month
 * boundary; reading it here previously meant "3 new workouts per
 * month", which reset every month and let a user accumulate an
 * unbounded number of workouts over time on the free tier — the exact
 * bug this total-cap rewrite closes).
 */

// ─── Public types ─────────────────────────────────────────────────────

/**
 * The set of feature gates the platform may enforce server-side. Three
 * categories today:
 *   - `create_workout`: ENFORCED in M10.5 on POST /workouts and on the
 *     fresh-workout branch of POST /sessions/record.
 *   - `ai_access`: ENFORCED in M9.5 on `POST /nutrition/ai/estimate` and
 *     `POST /nutrition/ai/estimate-text` (closes cross-cuts § 4.1 C6).
 *     Gates on `subscription_tiers.ai_access` — a binary flag, not a
 *     usage counter, so denies only ever carry reason `'tier'` /
 *     `'cancelled'` / `'expired'`, never `'limit'`.
 *   - `trainer_clients`: ENFORCED (revenue-leak fix) — denies when a
 *     trainer is at their tier's `trainer_client_limit` in ACTIVE human
 *     clients. See `evaluateTrainerClientsActiveSeat`; the invite-creation
 *     gate in `trainers/seats/trainerSeats.ts` additionally counts
 *     outstanding invitations.
 *   - `loadout`: ENFORCED (spec-21) on `subscription_tiers.loadout_access`.
 *   - `meal_ai`: ENFORCED (spec-26) on `subscription_tiers.mealprint_access` —
 *     a hard gate with NO taster (Brad 2026-07-24). ⚠ Spec-29 Phase 2
 *     (2026-08-05) made `mealprint_access` track `loadout_access` exactly: both
 *     are granted to `premium_plus` and the paid coach tiers
 *     (`start_up_coach_plus`/`coach`/`coach_pro`), NOT the entry rung
 *     `individual_trainer`. See the file header (§ `PREMIUM_PLUS_FEATURES`) for
 *     why the two features now share one upsell path.
 *   - everything else (`ai_workout`, `gym_buddy`,
 *     `unlimited_exercise_library`): STUB — returns `{ allowed: true }`
 *     today, wired into the read path so the helper signature stabilises
 *     before the consuming feature ships. Switching a stub on is a
 *     one-line change once the gym-buddy endpoint lands.
 */
export type EntitlementFeature =
  | "create_workout"
  | "ai_access"
  | "ai_workout"
  | "gym_buddy"
  | "unlimited_exercise_library"
  | "trainer_clients"
  | "loadout"
  | "meal_ai";

/**
 * The adaptive-workout SUITE features — Loadout + Mealprint — as opposed to the
 * features any paid tier unlocks. Drives `pickUpgradeTier`: a suite deny must
 * upsell a suite-bearing tier, never the cheapest paid one — upselling the wrong
 * tier would take the user's money and still leave the feature locked.
 *
 * ⚠ Spec-29 Phase 2 (2026-08-05): the suite is now carried by `premium_plus`
 * (consumers) AND the paid coach tiers `start_up_coach_plus` / `coach` /
 * `coach_pro`. The entry coach rung `individual_trainer` (Start Up Coach) is the
 * one paid coach tier WITHOUT it (AC 1.3, `20260805120000_coach_ladder_restructure.sql`).
 * Because BOTH suite features now have a valid coach upsell (Start Up Coach +),
 * `loadout` and `meal_ai` route identically — which is why the former
 * `PREMIUM_PLUS_ONLY_FEATURES` split (meal_ai had no trainer upsell) no longer
 * exists. `pickUpgradeTier` branches on ROLE, not on which suite feature.
 */
const PREMIUM_PLUS_FEATURES: ReadonlySet<EntitlementFeature> = new Set([
  "loadout",
  "meal_ai",
]);

/**
 * Spec-narrow tier-name union. Reflects the spec-29 Phase 2 coach ladder
 * (`20260805120000_coach_ladder_restructure.sql`): Free + Premium + Premium+ for
 * consumers, and the coach ladder `individual_trainer` (Start Up Coach, no suite)
 * / `start_up_coach_plus` / `coach` / `coach_pro` (all suite-bearing). The old
 * `small_business` / `medium_enterprise` business tiers were RETIRED and replaced
 * by `coach` / `coach_pro`; their rows survive inactive as FK tombstones but the
 * union drops them. `premium_plus` (M19-P0) and the coach suite tiers gate the
 * adaptive-workout suite (Loadout + Mealprint). Unknown tier strings collapse to
 * `'free'` via `coerceTierName` so the wire payload never carries an arbitrary
 * string.
 */
export type SubscriptionTierName =
  | "free"
  | "premium"
  | "premium_plus"
  | "individual_trainer"
  | "start_up_coach_plus"
  | "coach"
  | "coach_pro";

/**
 * Why an entitlement assertion was denied. Mobile uses this to pick the
 * gate-prompt copy:
 *   - `tier`: user is on a tier that has the feature flag disabled
 *     (`ai_access` on free tier; stubs never reach this today).
 *   - `limit`: feature flag is on but the per-month counter is at cap.
 *   - `cancelled`: sub was cancelled and the grace expires_at has
 *     passed — the user reverts to free-tier rules, so this reason only
 *     surfaces once they have ALSO exhausted the free allowance; mobile
 *     shows the "your sub was cancelled" reinstate CTA rather than
 *     "upgrade".
 *   - `expired`: payment_status indicates failure (`past_due`, `unpaid`,
 *     `incomplete_expired`) — likewise revert-to-free, and this reason
 *     surfaces once the free allowance is gone; user needs to update
 *     payment, not pick a new tier.
 *   - `workout_limit_exceeded`: a DISTINCT reason from `evaluateWorkoutTotalCapLock`
 *     (the `POST /sessions/record` anti-abuse backstop), never returned by
 *     `assertEntitlement` itself. Unlike `limit` (which denies AT the cap on a
 *     NEW create), this denies STRICTLY OVER the cap on RECORDING against an
 *     already-owned workout — the trial-abuse path where a user built up a
 *     stash of workouts on a paid tier, downgraded to free, and kept logging
 *     against every one of them via the `canSkipGate` owned-workout bypass in
 *     `sessionsRecordHandler.ts`. Mobile renders distinct "you're over the
 *     free limit — delete or upgrade" copy for this reason rather than the
 *     ordinary at-cap / lapsed-sub prompts.
 */
export type EntitlementDenyReason =
  | "tier"
  | "limit"
  | "cancelled"
  | "expired"
  | "workout_limit_exceeded";

/**
 * Verdict returned by `assertEntitlement`. Discriminated by `allowed`
 * so callers narrow cleanly:
 *
 *   const v = await assertEntitlement(userId, "create_workout");
 *   if (!v.allowed) throw new EntitlementError(v);
 *   // v is { allowed: true } here
 */
export type EntitlementVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: EntitlementDenyReason;
      currentTier: SubscriptionTierName;
      upgradeTo: SubscriptionTierName | null;
      upgradePriceMonthly: number | null;
    };

/**
 * Domain error wrapping a deny verdict. Thrown by handlers when the
 * verdict denies; mapped to HTTP 402 by `coreErrorHandler` in
 * `shared/errorHandler.ts`. The wire payload uses snake_case to match
 * the mobile adapter's expected fields (see design.md § Entitlement
 * enforcement > 402 response shape).
 */
export class EntitlementError extends Error {
  // Plain field declarations (not constructor parameter properties) —
  // the web package's tsconfig has `erasableSyntaxOnly: true` set,
  // which forbids parameter properties because they emit runtime
  // assignment code at construction. Field declarations + an explicit
  // assignment in the body satisfy the lint and keep the public
  // surface identical.
  public readonly verdict: Extract<EntitlementVerdict, { allowed: false }>;
  public readonly feature: EntitlementFeature;

  constructor(
    verdict: Extract<EntitlementVerdict, { allowed: false }>,
    feature: EntitlementFeature,
  ) {
    super("ENTITLEMENT_DENIED");
    this.verdict = verdict;
    this.feature = feature;
    // Re-set the prototype so `instanceof EntitlementError` works after
    // transpilation through downlevel ES targets. Node 20+ doesn't need
    // this, but the build still compiles to commonjs through TS, so the
    // belt-and-braces fix avoids surprises.
    Object.setPrototypeOf(this, EntitlementError.prototype);
    this.name = "EntitlementError";
  }
}

// ─── Helper ───────────────────────────────────────────────────────────

/**
 * Resolve the user's entitlement to `feature` against live DB state.
 *
 * Read strategy:
 *   1. SELECT `profiles.role` for the user — needed to pick the right
 *      upgrade target (user-role vs trainer-role) when the verdict is a
 *      `'limit'` deny. Missing profile → throws (schema corruption).
 *   2. SELECT most-recent `user_subscriptions` row joined with
 *      `subscription_tiers` (LEFT JOIN, ordered by `createdAt DESC`,
 *      limit 1). Missing sub → treat the user as `free`.
 *   3. SELECT `COUNT(*) FROM workouts WHERE created_by = userId` if the
 *      feature requires a usage count (currently only `create_workout`).
 *      This is the user's TOTAL workout count, ever — the same query
 *      `workoutRepository.getQuota()` runs for the mobile "N of 3
 *      workouts" display. NOT `subscription_limits.current_count` (a
 *      MONTHLY counter that resets on month boundary — reading it here
 *      would mean "3 new workouts per month", not "3 workouts total",
 *      which is the free-tier rule Brad locked).
 *
 * Verdict logic for `create_workout`:
 *   - `payment_status NOT IN ('active', 'trialing')` AND (no
 *     `expires_at` OR `expires_at <= NOW()`) → sub is cancelled /
 *     expired. The user is NOT cut off: they *revert to free-tier
 *     rules*. The effective limit is clamped to the free tier's
 *     `workout_limit` (3) and the count check runs as for a free user,
 *     EXCEPT the deny reason carries `'cancelled'` / `'expired'` (not
 *     `'limit'`) so mobile shows the reinstate / fix-payment CTA.
 *     Cancelled-with-future-expires_at is still fully entitled until
 *     that expiry — the user paid through that date.
 *   - `tier.workout_limit IS NULL` (active premium / trainer) →
 *     unlimited → allowed.
 *   - `total_workout_count >= effective workout_limit` → deny. Reason is
 *     `'limit'` for an active tier at cap (upgrade_to = cheapest tier
 *     that satisfies, per role), or `'cancelled'` / `'expired'` for a
 *     reverted sub that has also exhausted its free allowance
 *     (upgrade_to = null — reinstate / fix payment instead).
 *   - Otherwise → allowed.
 *
 * Verdict logic for `ai_access` (M9.5, cross-cuts § 4.1):
 *   - Binary flag gate, not a usage counter — `subscription_tiers.ai_access`
 *     directly decides allow/deny. There is no `subscription_limits` row
 *     to consult, so denies here only ever carry reason `'tier'` (flag
 *     off), `'cancelled'`, or `'expired'` — never `'limit'`.
 *   - No sub row → free tier → check free tier's `ai_access` (false today)
 *     → deny reason `'tier'` if false.
 *   - `payment_status` classifies as cancelled/expired (same
 *     `classifySubscriptionStatus` used by `create_workout`) → the user
 *     reverts to free-tier rules for the flag check (not just the
 *     limit), and if the free tier's flag is also off, deny reason is
 *     `'cancelled'` / `'expired'` (not `'tier'`) — mirrors
 *     `create_workout`'s revert-to-free treatment exactly, just gating a
 *     flag instead of a counter.
 *   - Otherwise: effective tier's `ai_access === true` → allowed;
 *     `false` → deny reason `'tier'`.
 *   - `upgradeTo` for a `'tier'` deny reuses `pickUpgradeTier` — per
 *     `20260526120000_simplify_tier_model.sql`, "AI access becomes a
 *     paid-tier USP: Premium + any Trainer tier all get AI", i.e. EVERY
 *     paid tier in the catalog has `ai_access = true`. That makes the
 *     cheapest ai_access=true tier for a given role identical to the
 *     cheapest paid tier for that role, which is exactly what
 *     `pickUpgradeTier` already resolves for `create_workout` — no
 *     separate "query subscription_tiers for the cheapest ai_access=true
 *     row" lookup is needed unless the catalog ever ships a paid tier
 *     without AI (it doesn't today).
 *
 * `trainer_clients` routes to `assertTrainerClients` (real cap check). The
 * remaining stub features (`ai_workout`, `gym_buddy`,
 * `unlimited_exercise_library`) always return `{ allowed: true }` today —
 * the read path is wired but the verdict short-circuits (see AC 9.5).
 */
export async function assertEntitlement(
  userId: string,
  feature: EntitlementFeature,
): Promise<EntitlementVerdict> {
  if (feature === "ai_access") {
    return assertAiAccess(userId);
  }

  // Trainer client-slot cap (revenue-leak fix). Real count-vs-limit check —
  // see `assertTrainerClients`.
  if (feature === "trainer_clients") {
    return assertTrainerClients(userId);
  }

  // Loadout (spec-21 § 5.1) — reads `subscription_tiers.loadout_access`.
  //
  // ⚠ THIS ROUTING LINE IS MANDATORY, not tidiness. The catch-all immediately
  // below returns `{ allowed: true }` for ANY feature that isn't explicitly
  // routed — so a new feature name added to the union without a line here
  // SILENTLY ALLOWS EVERYONE, turning a paid gate into a no-op with no test
  // failure and no type error to catch it.
  if (feature === "loadout") {
    return assertLoadout(userId);
  }

  // Mealprint (spec-26 § 3) — reads `subscription_tiers.mealprint_access`.
  //
  // ⚠ MANDATORY ROUTING LINE, for the same reason as `loadout` above: without
  // it, `meal_ai` falls through the catch-all below and every Mealprint endpoint
  // becomes free for everyone, with no type error and no failing test. This is a
  // £29.99/mo gate on a feature whose per-user ceiling cost is ~£7/mo, so the
  // silent-allow failure is directly expensive.
  if (feature === "meal_ai") {
    return assertMealprint(userId);
  }

  // Remaining stub features (`ai_workout`, `gym_buddy`,
  // `unlimited_exercise_library`) are accept-all today (AC 9.5). The contract
  // is in place so consumers can call `assertEntitlement(uid, 'ai_workout')`
  // already; flipping a stub off when its endpoint ships is a one-line change.
  if (feature !== "create_workout") {
    return { allowed: true };
  }

  const db = getDb();

  // 1. Profile slice — role drives upgrade-target selection. Missing
  //    profile is a schema-corruption condition (JWT bound a user that
  //    has no `profiles` row); throwing surfaces it as 500 through the
  //    error handler rather than silently treating them as `free`.
  const profileRows = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new Error(
      `assertEntitlement: no profiles row for user ${userId} — schema corruption (JWT-bound user without profile)`,
    );
  }
  const role = normaliseRole(profile.role);

  // 2. Latest subscription joined with the tier (for workout_limit +
  //    feature flags + price). LEFT JOIN tier so a sub with an
  //    out-of-band tier_name (deleted from the catalog) still surfaces
  //    rather than silently dropping the user back to free.
  const subRows = await db
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      workoutLimit: subscriptionTiers.workoutLimit,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  // Resolve effective tier + workout_limit. Three cases:
  //   (a) No sub row → free tier metadata from the catalog.
  //   (b) Sub row with a known tier → use the joined fields.
  //   (c) Sub row with an unknown tier (catalog row deleted) →
  //       coerce to `free` so the wire never carries an arbitrary
  //       string; use the joined workout_limit which is null in that
  //       case, treated as 0 below.
  let effectiveTierName: SubscriptionTierName;
  let workoutLimit: number | null;

  if (subRow === null) {
    const freeTier = await loadTier(db, "free");
    if (!freeTier) {
      // Deploy misconfig — the free tier MUST exist in the catalog.
      // Throwing surfaces it as 500 rather than silently allowing or
      // denying on incomplete data.
      throw new Error(
        "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
      );
    }
    effectiveTierName = "free";
    workoutLimit = freeTier.workoutLimit ?? null;
  } else {
    effectiveTierName = coerceTierName(subRow.tierName);
    workoutLimit = subRow.workoutLimit ?? null;
  }

  // 3. Status check BEFORE the count check. A cancelled or expired sub
  //    does NOT cut the user off entirely — per AC 9.3 + AC 9.6 the
  //    JWT's (possibly stale) premium claim is not trusted and the user
  //    *reverts to free-tier rules*. We therefore clamp the effective
  //    workout limit DOWN to the free tier's limit (3) and remember the
  //    status as the deny *reason* — so:
  //      - a cancelled/expired user still under the free allowance is
  //        ALLOWED (previously they were hard-denied 402 on every create
  //        regardless of usage — the over-block bug surfaced in #117
  //        device testing on a premium-cancelled account); and
  //      - one who is over it is denied with the cancelled / expired
  //        reason (upgradeTo=null), so mobile shows the reinstate /
  //        fix-payment CTA rather than a plain "upgrade" prompt.
  //    `currentTier` in the verdict stays the user's *actual* tier
  //    (e.g. 'premium') so mobile can offer to reinstate the right plan.
  //
  //    Cancelled-but-still-within-paid-period (`expires_at` in the
  //    future) returns null from classifySubscriptionStatus and keeps
  //    full entitlement until that date — handled above, not here.
  let denyReason: EntitlementDenyReason = "limit";
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      const freeTier = await loadTier(db, "free");
      if (!freeTier) {
        // Same catalog-misconfig guard as the no-sub branch: free MUST
        // exist for revert-to-free to have a limit to enforce.
        throw new Error(
          "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
        );
      }
      workoutLimit = freeTier.workoutLimit ?? null;
      denyReason = statusDeny;
    }
  }

  // 4. No workout limit → unlimited → allowed. Reachable for an active
  //    premium / trainer tier (tier limit NULL), and — only if the free
  //    tier itself were configured with a NULL limit (it is 3 today) —
  //    for a reverted cancelled/expired user. We don't hardcode free=3.
  if (workoutLimit === null) {
    return { allowed: true };
  }

  // 5. Total workout count, ever — NOT the monthly `subscription_limits`
  //    counter. Free tier is 3 workouts TOTAL (Brad, locked product
  //    decision): the monthly counter reset every month and let a free
  //    user accumulate an unbounded number of workouts over time, 3 at a
  //    time — the exact bug this rewrite closes. This is the identical
  //    query `workoutRepository.getQuota()` runs for the mobile "N of 3
  //    workouts" display, so the create-gate and the display agree.
  const totalRows = await db
    .select({ value: count() })
    .from(workouts)
    .where(eq(workouts.createdBy, userId));
  const currentCount = totalRows[0].value;

  if (currentCount >= workoutLimit) {
    return buildDenyVerdict({
      // 'limit' for an active tier at cap; 'cancelled' / 'expired' for a
      // reverted sub that has also used up its free allowance.
      reason: denyReason,
      currentTier: effectiveTierName,
      role,
      feature: "create_workout",
    });
  }

  return { allowed: true };
}

/**
 * `ai_access` verdict — see the doc comment above `assertEntitlement` for
 * the full rules. Split out of the main function because the shape of
 * the check (a boolean flag, no `subscription_limits` counter) diverges
 * enough from `create_workout`'s limit-check flow that interleaving both
 * in one function body would obscure both. Shares `loadTier`,
 * `classifySubscriptionStatus`, `coerceTierName`, `normaliseRole`,
 * `pickUpgradeTier`, and `buildDenyVerdict` with the `create_workout`
 * path.
 */
async function assertAiAccess(userId: string): Promise<EntitlementVerdict> {
  const db = getDb();

  // 1. Profile slice — same schema-corruption guard as create_workout.
  const profileRows = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new Error(
      `assertEntitlement: no profiles row for user ${userId} — schema corruption (JWT-bound user without profile)`,
    );
  }
  const role = normaliseRole(profile.role);

  // 2. Latest subscription joined with the tier, this time for the
  //    ai_access flag rather than workout_limit.
  const subRows = await db
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      aiAccess: subscriptionTiers.aiAccess,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  // Resolve effective tier + ai_access flag. Same three cases as
  // create_workout's workoutLimit resolution:
  //   (a) no sub row → free tier catalog flag
  //   (b) sub row with a known tier → joined flag
  //   (c) sub row with an unknown/deleted tier → coerced to 'free', the
  //       joined flag is null in that case, treated as false below.
  let effectiveTierName: SubscriptionTierName;
  let aiAccessFlag: boolean | null;

  if (subRow === null) {
    const freeTier = await loadTier(db, "free");
    if (!freeTier) {
      throw new Error(
        "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
      );
    }
    effectiveTierName = "free";
    aiAccessFlag = freeTier.aiAccess;
  } else {
    effectiveTierName = coerceTierName(subRow.tierName);
    aiAccessFlag = subRow.aiAccess ?? null;
  }

  // 3. Status check BEFORE the flag check — cancelled/expired subs
  //    revert to free-tier rules (per create_workout's precedent), and
  //    if the free tier also lacks ai_access, the deny reason surfaces
  //    as 'cancelled' / 'expired' rather than 'tier' so mobile shows the
  //    reinstate / fix-payment CTA instead of a plain upgrade prompt.
  let denyReason: EntitlementDenyReason = "tier";
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      const freeTier = await loadTier(db, "free");
      if (!freeTier) {
        throw new Error(
          "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
        );
      }
      aiAccessFlag = freeTier.aiAccess;
      denyReason = statusDeny;
    }
  }

  if (aiAccessFlag === true) {
    return { allowed: true };
  }

  return buildDenyVerdict({
    // 'tier' for an active-but-flag-off tier (today only reachable via
    // free — every paid tier ships ai_access=true); 'cancelled' /
    // 'expired' for a reverted sub whose free-tier fallback also lacks
    // the flag.
    reason: denyReason,
    currentTier: effectiveTierName,
    role,
    feature: "ai_access",
  });
}

/**
 * `loadout` verdict — Loadout (spec-21 § 5.1), gating the adaptive-workout
 * suite. A near-clone of `assertAiAccess` with `subscription_tiers.ai_access`
 * swapped for `subscription_tiers.loadout_access`: profile read → latest
 * `user_subscriptions` LEFT JOIN `subscription_tiers` → revert-to-free on a
 * cancelled/expired sub → allow on `true` → deny otherwise.
 *
 * The flag lives in the CATALOG rather than in a hardcoded
 * `tierName === "premium_plus"` check so the catalog stays the single source of
 * truth — a future B2B seat tier (M21) becomes a data change, not a code change.
 * `loadout_access` is true for `premium_plus` and all three trainer tiers
 * (AC-9.2), granted by `20260725194527_premium_plus_tier.sql`.
 *
 * A deny is a 402 whose `upgrade_to` is `premium_plus` for athletes (see
 * `pickUpgradeTier`) and whose price comes from the catalog row — so AC-9.4's
 * "never a hardcoded price" holds for free.
 */
async function assertLoadout(userId: string): Promise<EntitlementVerdict> {
  const db = getDb();

  // 1. Profile slice — same schema-corruption guard as the other paths.
  const profileRows = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new Error(
      `assertEntitlement: no profiles row for user ${userId} — schema corruption (JWT-bound user without profile)`,
    );
  }
  const role = normaliseRole(profile.role);

  // 2. Latest subscription joined with the tier, for the loadout_access flag.
  const subRows = await db
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      loadoutAccess: subscriptionTiers.loadoutAccess,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  // Same three cases as ai_access: no sub row → free-tier flag; known tier →
  // joined flag; unknown/deleted tier → coerced to 'free' with a null flag,
  // treated as false below.
  let effectiveTierName: SubscriptionTierName;
  let loadoutAccessFlag: boolean | null;

  if (subRow === null) {
    effectiveTierName = "free";
    loadoutAccessFlag = await loadFreeTierLoadoutAccess(db);
  } else {
    effectiveTierName = coerceTierName(subRow.tierName);
    loadoutAccessFlag = subRow.loadoutAccess ?? null;
  }

  // 3. Status check BEFORE the flag check — a cancelled/expired sub reverts to
  //    free-tier rules (free has loadout_access = false), and the deny reason
  //    becomes 'cancelled' / 'expired' so mobile shows the reinstate /
  //    fix-payment CTA rather than a plain upgrade prompt.
  let denyReason: EntitlementDenyReason = "tier";
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      loadoutAccessFlag = await loadFreeTierLoadoutAccess(db);
      denyReason = statusDeny;
    }
  }

  if (loadoutAccessFlag === true) {
    return { allowed: true };
  }

  return buildDenyVerdict({
    reason: denyReason,
    currentTier: effectiveTierName,
    role,
    feature: "loadout",
  });
}

/**
 * `meal_ai` verdict — Mealprint (spec-26 § 3), gating both the suggestion and
 * the plan-generation surfaces. Structurally identical to {@link assertLoadout}
 * with `loadout_access` swapped for `mealprint_access`.
 *
 * **Hard gate, no taster** (Brad 2026-07-24, spec-26 decision 2). There is no
 * free code path and no preview of real output; comps and time-boxed promotions
 * arrive as RevenueCat promotional entitlements through the existing webhook →
 * `user_subscriptions` path, which this function sees as an ordinary Premium+
 * grant and needs no code for.
 *
 * ⚠ Spec-29 Phase 2 (2026-08-05): `mealprint_access` now tracks `loadout_access`
 * exactly — TRUE for `premium_plus` and the paid coach tiers
 * (`start_up_coach_plus`/`coach`/`coach_pro`), FALSE for the entry rung
 * `individual_trainer` (`20260805120000_coach_ladder_restructure.sql`). Both suite
 * features share one upsell path via `PREMIUM_PLUS_FEATURES`: a denied coach is
 * upsold `start_up_coach_plus`, a denied consumer `premium_plus`
 * (see `pickUpgradeTier`). The former Premium+-only split no longer exists.
 */
async function assertMealprint(userId: string): Promise<EntitlementVerdict> {
  const db = getDb();

  const profileRows = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new Error(
      `assertEntitlement: no profiles row for user ${userId} — schema corruption (JWT-bound user without profile)`,
    );
  }
  const role = normaliseRole(profile.role);

  const subRows = await db
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      mealprintAccess: subscriptionTiers.mealprintAccess,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  // Same three cases as the other flag gates: no sub row → free-tier flag;
  // known tier → joined flag; unknown/deleted tier → coerced to 'free' with a
  // null flag, treated as false below.
  let effectiveTierName: SubscriptionTierName;
  let mealprintAccessFlag: boolean | null;

  if (subRow === null) {
    effectiveTierName = "free";
    mealprintAccessFlag = await loadFreeTierMealprintAccess(db);
  } else {
    effectiveTierName = coerceTierName(subRow.tierName);
    mealprintAccessFlag = subRow.mealprintAccess ?? null;
  }

  // Status check BEFORE the flag check — a cancelled/expired sub reverts to
  // free-tier rules and the deny reason becomes 'cancelled' / 'expired' so
  // mobile shows reinstate / fix-payment rather than a plain upgrade prompt.
  let denyReason: EntitlementDenyReason = "tier";
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      mealprintAccessFlag = await loadFreeTierMealprintAccess(db);
      denyReason = statusDeny;
    }
  }

  if (mealprintAccessFlag === true) {
    return { allowed: true };
  }

  return buildDenyVerdict({
    reason: denyReason,
    currentTier: effectiveTierName,
    role,
    feature: "meal_ai",
  });
}

// ─── Workout total-cap RECORD lock (anti-trial-abuse backstop) ────────

/**
 * Over-limit RECORD lock — a hard backstop closing the trial-abuse path
 * `create_workout`'s own cap cannot reach.
 *
 * Product decision (Brad, locked): free tier = 3 workouts TOTAL. A free
 * user who is OVER that total (not just at it) must be locked out of
 * starting/recording ANY workout session until they delete down to ≤3 or
 * upgrade — never auto-deleted.
 *
 * Why this can't just be `create_workout`'s existing `>= limit` check:
 * `POST /sessions/record` (`sessionsRecordHandler.ts`) skips the
 * `create_workout` gate entirely (`canSkipGate`) when the session
 * references a workout the caller already OWNS — deliberately, since the
 * user already "paid" the entitlement cost for that workout at create
 * time. But that means a user who built up a stash of workouts on a paid
 * tier and then downgraded to free can keep logging against every one of
 * those owned templates forever, with zero further checks — the exact
 * "make 20 workouts on trial → drop to Free → keep using them all" abuse
 * vector. This function is called from `sessionsRecordHandler.ts` BEFORE
 * `canSkipGate` is even evaluated, so it applies to owned-template
 * records too.
 *
 * Distinct from `create_workout` in three ways:
 *   1. Denies STRICTLY OVER the limit (`count > limit`), not AT it
 *      (`count >= limit`) — a user sitting at exactly 3 of 3 is not
 *      locked out of recording against their existing workouts, only an
 *      over-stocked user is.
 *   2. Always denies with reason `'workout_limit_exceeded'`, regardless
 *      of WHY the effective tier is free (genuinely free, or reverted
 *      cancelled/expired) — this check is "you're over the free total
 *      right now", not "why can't you create", so it doesn't reuse
 *      `'limit'` / `'cancelled'` / `'expired'`.
 *   3. Read-only, same as every other entitlement check — never deletes
 *      or touches a workout row. The user chooses what to remove; the
 *      primary UX (mobile's client-side gate on the start-workout entry
 *      points) is what stops a legitimate user from ever reaching this
 *      402 in the first place. This is the backstop for when they don't
 *      (stale client cache, a second device, direct API use).
 *
 * Resolution mirrors `create_workout`'s profile + latest-subscription +
 * revert-to-free-on-lapse read (same shared helpers: `loadTier`,
 * `classifySubscriptionStatus`, `coerceTierName`, `normaliseRole`), then
 * compares against the SAME total `COUNT(*) FROM workouts WHERE
 * created_by = userId` query `create_workout` and `workoutRepository
 * .getQuota()` both use.
 */
export async function evaluateWorkoutTotalCapLock(
  userId: string,
  executor: Pick<Db, "select"> = getDb(),
): Promise<EntitlementVerdict> {
  // 1. Profile slice — same schema-corruption guard as every other path.
  const profileRows = await executor
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new Error(
      `evaluateWorkoutTotalCapLock: no profiles row for user ${userId} — schema corruption (JWT-bound user without profile)`,
    );
  }
  const role = normaliseRole(profile.role);

  // 2. Latest subscription joined with the tier, for workout_limit — same
  //    shape as create_workout's resolution.
  const subRows = await executor
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      workoutLimit: subscriptionTiers.workoutLimit,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  let currentTier: SubscriptionTierName;
  let workoutLimit: number | null;

  if (subRow === null) {
    const freeTier = await loadTier(executor, "free");
    if (!freeTier) {
      throw new Error(
        "evaluateWorkoutTotalCapLock: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
      );
    }
    currentTier = "free";
    workoutLimit = freeTier.workoutLimit ?? null;
  } else {
    currentTier = coerceTierName(subRow.tierName);
    workoutLimit = subRow.workoutLimit ?? null;
  }

  // 3. Cancelled/expired → revert to free-tier rules, same clamp as
  //    create_workout. Unlike create_workout, we don't remember a
  //    status-specific deny reason here — every deny from this function
  //    is 'workout_limit_exceeded' regardless of why the tier is free.
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      const freeTier = await loadTier(executor, "free");
      if (!freeTier) {
        throw new Error(
          "evaluateWorkoutTotalCapLock: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
        );
      }
      workoutLimit = freeTier.workoutLimit ?? null;
    }
  }

  // 4. Unlimited (active paid tier, or a free tier configured with a
  //    NULL limit) → never locked.
  if (workoutLimit === null) {
    return { allowed: true };
  }

  // 5. Total workout count, ever — identical query to create_workout's
  //    count and workoutRepository.getQuota()'s `used`. Scoped strictly
  //    to this userId, so one user's stash can never affect another's
  //    verdict.
  const totalRows = await executor
    .select({ value: count() })
    .from(workouts)
    .where(eq(workouts.createdBy, userId));
  const totalCount = totalRows[0].value;

  // STRICTLY over — at exactly the limit is fine.
  if (totalCount > workoutLimit) {
    return buildDenyVerdict({
      reason: "workout_limit_exceeded",
      currentTier,
      role,
      feature: "create_workout",
    });
  }

  return { allowed: true };
}

// ─── Pure helpers (exported for testing) ──────────────────────────────

/**
 * Tier-status → deny reason mapping. `null` means "no status-based
 * deny — fall through to the count check".
 *
 * Rules:
 *   - `'active'` / `'trialing'` → no deny (premium-equivalent states).
 *   - `'cancelled'` with `expires_at > now` → no deny (user paid
 *     through that date and the sub stays entitled until then).
 *   - `'cancelled'` with no / past `expires_at` → `'cancelled'` deny.
 *   - `'past_due'` / `'unpaid'` / `'incomplete'` / `'incomplete_expired'`
 *     → `'expired'` deny (payment failed; user needs to fix card, not
 *     pick a new tier).
 *   - anything else (`'pending'`, unknown strings) → `'expired'` deny.
 *     Conservative: an unknown status defaults to denied rather than
 *     allowed, so a future Stripe status code we haven't taught the
 *     helper about doesn't silently grant access.
 */
export function classifySubscriptionStatus(
  paymentStatus: string | null,
  expiresAt: Date | string | null,
): EntitlementDenyReason | null {
  if (paymentStatus === "active" || paymentStatus === "trialing") {
    return null;
  }
  if (paymentStatus === "cancelled") {
    if (isExpiresInFuture(expiresAt)) {
      // Cancelled-but-still-paid-through → user keeps access until
      // the period they paid for ends.
      return null;
    }
    return "cancelled";
  }
  // past_due, unpaid, incomplete, incomplete_expired, pending,
  // unrecognised strings all collapse to 'expired' — they all mean
  // "payment is not in a working state".
  return "expired";
}

/**
 * `expires_at > now` — handles Date, ISO string, or null. Null /
 * unparseable values return false (treat as "no future expiry").
 */
export function isExpiresInFuture(
  expiresAt: Date | string | null | undefined,
): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

/**
 * Coerce a free-form tier_name string to the narrow union. Falls back
 * to `'free'` for unknown values — most restrictive default so an
 * unknown tier doesn't accidentally grant unlimited.
 *
 * (We don't keep an "unknown" union member because the verdict's
 * `currentTier` lands on the wire and mobile would have to handle yet
 * another string — collapsing to `free` keeps the wire stable.)
 */
export function coerceTierName(
  tierName: string | null | undefined,
): SubscriptionTierName {
  switch (tierName) {
    case "free":
    case "premium":
    case "premium_plus":
    case "individual_trainer":
    case "start_up_coach_plus":
    case "coach":
    case "coach_pro":
      return tierName;
    default:
      return "free";
  }
}

/**
 * Coerce `profiles.role` to the narrow union we drive upgrade-target
 * selection from. Mirrors the defensive coercion in
 * `subscriptionRepository.normaliseRole`.
 */
export function normaliseRole(
  role: string | null | undefined,
): "user" | "personal_trainer" | "physiotherapist" | "admin" {
  if (
    role === "personal_trainer" ||
    role === "physiotherapist" ||
    role === "admin"
  ) {
    return role;
  }
  return "user";
}

/**
 * Pick the upgrade target for a deny, from the caller's ROLE and the FEATURE
 * they were denied. Spec-29 Phase 2 (2026-08-05) picks:
 *   - `admin` → no upgrade target (admins shouldn't be denied; if they somehow
 *     are, the gate prompt has nothing useful to suggest).
 *   - `personal_trainer` → a SUITE deny (`loadout` / `meal_ai`) upsells
 *     `'start_up_coach_plus'` (£34.99 — the cheapest coach tier that carries the
 *     suite AND keeps them in coach mode); any other paid deny upsells
 *     `'individual_trainer'` (£18.99 — the entry coach rung).
 *   - `user` / `physiotherapist` → a suite deny upsells `'premium_plus'`
 *     (£29.99); otherwise `'premium'` (£16.99, the cheapest paid consumer tier).
 *
 * ⚠ Role decides the LADDER (coach vs consumer); feature decides the RUNG within
 * it. A coach must never be sent to `premium_plus` — that would strip their
 * coaching role — nor to `individual_trainer` for a suite feature, which does not
 * carry the suite: either way they pay and stay locked out. That is the exact
 * failure mode the required `feature` parameter exists to make a compile-time
 * concern rather than a silent one.
 *
 * Returns `null` to signal "no sensible upgrade", which mobile renders as a
 * generic "contact support" CTA.
 */
export function pickUpgradeTier(
  role: "user" | "personal_trainer" | "physiotherapist" | "admin",
  feature: EntitlementFeature,
): SubscriptionTierName | null {
  // Admins first — they should never be denied, and if they somehow are there is
  // nothing useful to suggest.
  if (role === "admin") return null;

  const isSuiteFeature = PREMIUM_PLUS_FEATURES.has(feature);

  // Coaches stay on the coach ladder so a deny never strips their coaching role.
  // Suite deny → cheapest suite-bearing coach tier; else the entry coach rung.
  if (role === "personal_trainer") {
    return isSuiteFeature ? "start_up_coach_plus" : "individual_trainer";
  }

  // user + physiotherapist: the consumer ladder.
  return isSuiteFeature ? "premium_plus" : "premium";
}

/**
 * Exported ONLY so the test suite can assert which features route to a
 * suite-bearing upsell rather than the cheapest paid tier (`pickUpgradeTier`).
 */
export const __entitlementUpgradeSetsForTest = {
  premiumPlus: PREMIUM_PLUS_FEATURES,
} as const;

// ─── Internal ─────────────────────────────────────────────────────────

/**
 * Drizzle db-or-tx — `getDb()` returns the typed Drizzle client; we
 * keep it loosely typed here to avoid importing the heavy generic chain
 * for a function that just runs one read.
 */
type Db = ReturnType<typeof getDb>;

interface TierMeta {
  tierName: string;
  workoutLimit: number | null;
  aiAccess: boolean;
  priceMonthly: number | null;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;
}

/**
 * Load tier metadata by name. Returns `null` when the row doesn't exist
 * — caller treats that as "fall back to free" or throws if free itself
 * is missing.
 */
async function loadTier(
  db: Pick<Db, "select">,
  tierName: string,
): Promise<TierMeta | null> {
  const rows = await db
    .select({
      tierName: subscriptionTiers.tierName,
      workoutLimit: subscriptionTiers.workoutLimit,
      aiAccess: subscriptionTiers.aiAccess,
      priceMonthly: subscriptionTiers.priceMonthly,
      trainerClientLimit: subscriptionTiers.trainerClientLimit,
      isTrainerTier: subscriptionTiers.isTrainerTier,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, tierName))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    tierName: row.tierName,
    workoutLimit: row.workoutLimit ?? null,
    aiAccess: row.aiAccess ?? false,
    priceMonthly: parsePriceDecimal(row.priceMonthly),
    trainerClientLimit: row.trainerClientLimit ?? null,
    isTrainerTier: row.isTrainerTier ?? false,
  };
}

/**
 * The free tier's `loadout_access` flag (false as seeded, and the value the
 * revert-to-free path falls back to).
 *
 * DELIBERATELY NOT folded into `loadTier`. `loadout_access` is a young column
 * whose PRODUCTION apply is manual (`20260725194527_premium_plus_tier.sql`), and
 * `loadTier` is on the hot path of `create_workout` AND `ai_access`. Projecting
 * the column there would mean a Lambda deployed ahead of the hand-applied
 * migration throws Postgres 42703 (`column loadout_access does not exist`) on
 * every workout-creation and AI deny — i.e. the new column would break features
 * that predate it. Keeping the read here confines that blast radius to Loadout
 * itself, which is unreachable until the tier goes active anyway.
 *
 * Throws when the free row is missing, matching the catalog-misconfiguration
 * guard the other paths use — a missing free tier means revert-to-free has no
 * rules to enforce, and silently allowing or denying on incomplete data is worse
 * than a 500.
 */
async function loadFreeTierLoadoutAccess(
  db: Pick<Db, "select">,
): Promise<boolean> {
  const rows = await db
    .select({ loadoutAccess: subscriptionTiers.loadoutAccess })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, "free"))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(
      "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
    );
  }
  return row.loadoutAccess ?? false;
}

/**
 * The free tier's `mealprint_access` flag (false as seeded, and the value the
 * revert-to-free path falls back to).
 *
 * Split out for exactly the reason `loadFreeTierLoadoutAccess` is: folding a
 * YOUNG column into `loadTier` would put it on the hot path of `create_workout`
 * and `ai_access`, so a Lambda running against a database that does not yet have
 * the column would throw Postgres 42703 on every workout creation and AI deny —
 * the new column breaking features that predate it.
 *
 * ⚠ That window is the MIGRATE-THEN-DEPLOY gap, not a manual apply. An earlier
 * version of this comment said "the hand-applied migration", contradicting
 * STATE.md § Verified facts: `production-deploy.yml` applies migrations
 * automatically, before `sst deploy`. The hazard is real either way — the
 * previous release's Lambda serves briefly against the new schema, and a
 * rollback inverts it — so the split-out read stays. Confining the read here bounds the
 * blast radius to Mealprint, which is unreachable until `premium_plus` goes
 * active anyway.
 */
async function loadFreeTierMealprintAccess(
  db: Pick<Db, "select">,
): Promise<boolean> {
  const rows = await db
    .select({ mealprintAccess: subscriptionTiers.mealprintAccess })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, "free"))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(
      "assertEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
    );
  }
  return row.mealprintAccess ?? false;
}

/**
 * Drizzle returns `decimal` columns as strings to preserve precision
 * (`'7.99'`). We coerce to `number` for the wire payload — JS numbers
 * have enough precision for sub-£10k pricing and matching the mobile
 * adapter's expected `number` type avoids forcing every consumer to
 * parse.
 */
export function parsePriceDecimal(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Build a deny verdict, resolving the upgrade-tier metadata from live
 * DB so the wire payload carries the current price. Pulling the price
 * out of DB rather than hardcoding it keeps the helper resilient to
 * pricing changes (which Brad has signalled will happen pre-launch).
 */
async function buildDenyVerdict(input: {
  reason: EntitlementDenyReason;
  currentTier: SubscriptionTierName;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  /** Threaded through to `pickUpgradeTier` — a Premium+-only feature upsells
   *  Premium+, everything else upsells Premium. */
  feature: EntitlementFeature;
}): Promise<Extract<EntitlementVerdict, { allowed: false }>> {
  const { reason, currentTier, role, feature } = input;

  // For cancelled / expired we don't suggest an upgrade — the user
  // needs to fix payment or reinstate, not pick a higher tier. Mobile
  // hides the price CTA when upgradeTo is null.
  if (reason === "cancelled" || reason === "expired") {
    return {
      allowed: false,
      reason,
      currentTier,
      upgradeTo: null,
      upgradePriceMonthly: null,
    };
  }

  const upgradeTierName = pickUpgradeTier(role, feature);
  if (upgradeTierName === null) {
    return {
      allowed: false,
      reason,
      currentTier,
      upgradeTo: null,
      upgradePriceMonthly: null,
    };
  }

  const tier = await loadTier(getDb(), upgradeTierName);
  return {
    allowed: false,
    reason,
    currentTier,
    upgradeTo: upgradeTierName,
    upgradePriceMonthly: tier?.priceMonthly ?? null,
  };
}

// ─── Trainer client-slot cap (revenue-leak fix) ───────────────────────

/**
 * Resolved tier context for the `trainer_clients` cap, shared by the
 * entitlement verdict (`assertTrainerClients`) and the seat-availability
 * gates in `trainers/seats/trainerSeats.ts`. Resolution mirrors
 * `create_workout` / `ai_access`: latest subscription joined to its tier,
 * with cancelled/expired subs reverting to free-tier rules (per AC 9.3 /
 * AC 9.6). `currentTier` stays the user's ACTUAL tier for the verdict, but
 * `limit` / `isTrainerTier` reflect the effective (post-revert) tier.
 *
 * Unlike `create_workout`, the discriminator is `isTrainerTier`, NOT the
 * limit being null: `trainer_client_limit` is NULL on non-trainer tiers
 * (free/premium) — that means "no client slots", not "unlimited". A trainer
 * tier with a NULL limit (none ship today, but the shape allows it) is the
 * only genuine "unlimited" case.
 */
export interface TrainerClientsTierContext {
  /** The user's ACTUAL tier — used as the verdict's `currentTier`. */
  currentTier: SubscriptionTierName;
  /** Effective `trainer_client_limit` after any cancelled/expired revert. */
  limit: number | null;
  /** Whether the effective (post-revert) tier grants client slots. */
  isTrainerTier: boolean;
  /**
   * Deny reason to use when the tier itself grants no slots: `'tier'` for a
   * live non-trainer tier, `'cancelled'` / `'expired'` for a reverted sub.
   * Ignored when `isTrainerTier` is true (the count decides then).
   */
  baseDenyReason: EntitlementDenyReason;
}

/**
 * Resolve the trainer's effective client-slot tier context. Read-only.
 * Pass a `tx` executor when called inside a transaction (e.g. under the
 * per-trainer accept lock) so the read is consistent with the count.
 */
export async function resolveTrainerClientsEntitlement(
  userId: string,
  executor: Pick<Db, "select"> = getDb(),
): Promise<TrainerClientsTierContext> {
  const subRows = await executor
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      trainerClientLimit: subscriptionTiers.trainerClientLimit,
      isTrainerTier: subscriptionTiers.isTrainerTier,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const subRow = subRows[0] ?? null;

  let currentTier: SubscriptionTierName;
  let limit: number | null;
  let isTrainerTier: boolean;

  if (subRow === null) {
    const freeTier = await loadTier(executor, "free");
    if (!freeTier) {
      throw new Error(
        "resolveTrainerClientsEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
      );
    }
    currentTier = "free";
    limit = freeTier.trainerClientLimit;
    isTrainerTier = freeTier.isTrainerTier;
  } else {
    currentTier = coerceTierName(subRow.tierName);
    limit = subRow.trainerClientLimit ?? null;
    isTrainerTier = subRow.isTrainerTier ?? false;
  }

  // Cancelled / expired → revert to free-tier rules (mirrors create_workout /
  // ai_access). A trainer whose sub lapsed loses their slots.
  let baseDenyReason: EntitlementDenyReason = "tier";
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      const freeTier = await loadTier(executor, "free");
      if (!freeTier) {
        throw new Error(
          "resolveTrainerClientsEntitlement: subscription_tiers row for tier_name='free' is missing — catalog misconfiguration",
        );
      }
      limit = freeTier.trainerClientLimit;
      isTrainerTier = freeTier.isTrainerTier;
      baseDenyReason = statusDeny;
    }
  }

  return { currentTier, limit, isTrainerTier, baseDenyReason };
}

/**
 * Count a trainer's ACTIVE, human (non-AI) client relationships — the
 * canonical "occupied seats" count used everywhere the cap is enforced
 * (this verdict, the accept-time backstop). Pass a `tx` executor inside a
 * transaction so the count is consistent with the surrounding lock.
 */
export async function countActiveTrainerClients(
  executor: Pick<Db, "select">,
  trainerId: string,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    );
  return rows[0]?.total ?? 0;
}

/**
 * The upgrade target one step up the trainer-tier SEAT ladder. Used for the
 * `trainer_clients` `'limit'` upsell (a trainer at cap should be pointed at the
 * next tier with MORE client seats, NOT the role-based cheapest paid tier that
 * `pickUpgradeTier` resolves).
 *
 * ⚠ Spec-29 Phase 2 (2026-08-05): the seat rungs are 5 → 15 → 30 =
 * `individual_trainer` / `start_up_coach_plus` (both 5) → `coach` (15) →
 * `coach_pro` (30, the top in-app rung → `null`; above it is the web/org rail).
 * `start_up_coach_plus` is a SUITE upgrade at the same 5-seat cap, so from a SEAT
 * deny it steps to `coach`, not to itself. A non-trainer tier maps to the cheapest
 * coach tier.
 */
export function nextTrainerTierUp(
  tier: SubscriptionTierName,
): SubscriptionTierName | null {
  switch (tier) {
    case "individual_trainer":
    case "start_up_coach_plus":
      return "coach";
    case "coach":
      return "coach_pro";
    case "coach_pro":
      return null;
    case "free":
    case "premium":
    case "premium_plus":
      // Consumer tiers have no "next trainer tier up" of their own, so a
      // `trainer_clients` deny points them at the cheapest coach rung.
      return "individual_trainer";
  }
}

/**
 * Build a `trainer_clients` deny verdict, resolving the upgrade tier's live
 * price. `'cancelled'` / `'expired'` carry no upgrade CTA (reinstate / fix
 * payment); `'tier'` and `'limit'` step up the trainer-tier ladder via
 * `nextTrainerTierUp`.
 */
export async function buildTrainerClientsDenyVerdict(input: {
  reason: EntitlementDenyReason;
  currentTier: SubscriptionTierName;
  executor?: Pick<Db, "select">;
}): Promise<Extract<EntitlementVerdict, { allowed: false }>> {
  const { reason, currentTier } = input;
  const executor = input.executor ?? getDb();

  if (reason === "cancelled" || reason === "expired") {
    return {
      allowed: false,
      reason,
      currentTier,
      upgradeTo: null,
      upgradePriceMonthly: null,
    };
  }

  const upgradeTo = nextTrainerTierUp(currentTier);
  if (upgradeTo === null) {
    return {
      allowed: false,
      reason,
      currentTier,
      upgradeTo: null,
      upgradePriceMonthly: null,
    };
  }

  const tier = await loadTier(executor, upgradeTo);
  return {
    allowed: false,
    reason,
    currentTier,
    upgradeTo,
    upgradePriceMonthly: tier?.priceMonthly ?? null,
  };
}

/**
 * Shared `trainer_clients` "hard cap" core: is the trainer under their tier's
 * `trainer_client_limit` in ACTIVE human clients? Returns `{ allowed: true }`
 * or the deny verdict (which the caller either throws as an `EntitlementError`
 * or reads for a notification's upgrade pointer). Non-trainer / reverted subs
 * deny with `'tier'` / `'cancelled'` / `'expired'`; a trainer tier with a NULL
 * limit is unlimited.
 *
 * Pass a `tx` executor when calling under the per-trainer accept lock so the
 * tier read + active count are consistent with the surrounding transaction.
 * The invite-CREATION gate additionally counts outstanding invitations against
 * the cap — see `evaluateTrainerJoinSeat` / `assertTrainerCanInvite` in
 * `trainers/seats/trainerSeats.ts`.
 */
export async function evaluateTrainerClientsActiveSeat(
  userId: string,
  executor: Pick<Db, "select"> = getDb(),
): Promise<EntitlementVerdict> {
  const ctx = await resolveTrainerClientsEntitlement(userId, executor);

  if (!ctx.isTrainerTier) {
    return buildTrainerClientsDenyVerdict({
      reason: ctx.baseDenyReason,
      currentTier: ctx.currentTier,
      executor,
    });
  }

  // Trainer tier with an unlimited (NULL) cap → allowed.
  if (ctx.limit === null) {
    return { allowed: true };
  }

  const activeClients = await countActiveTrainerClients(executor, userId);
  if (activeClients >= ctx.limit) {
    return buildTrainerClientsDenyVerdict({
      reason: "limit",
      currentTier: ctx.currentTier,
      executor,
    });
  }

  return { allowed: true };
}

/** `trainer_clients` entitlement verdict for `assertEntitlement`. */
async function assertTrainerClients(
  userId: string,
): Promise<EntitlementVerdict> {
  return evaluateTrainerClientsActiveSeat(userId, getDb());
}
