import { and, desc, eq, gte } from "drizzle-orm";
import {
  profiles,
  subscriptionLimits,
  subscriptionTiers,
  userSubscriptions,
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
 * Likewise, the workout-count comparison is read from
 * `subscription_limits.current_count` rather than recomputed from
 * `workouts` rows — the trigger advances `current_count` on each
 * `workouts` insert and resets it on month boundary, so its value is
 * the canonical "workouts used this month" for the active user. Calling
 * `COUNT(*) FROM workouts WHERE …` would risk drift if the trigger ever
 * fires for a path the count query doesn't see (e.g. trainer-on-behalf
 * inserts in M8).
 */

// ─── Public types ─────────────────────────────────────────────────────

/**
 * The set of feature gates the platform may enforce server-side. Two
 * categories today:
 *   - `create_workout`: ENFORCED in M10.5 on POST /workouts and on the
 *     fresh-workout branch of POST /sessions/record.
 *   - everything else: STUB — returns `{ allowed: true }` today, wired
 *     into the read path so the helper signature stabilises before the
 *     consuming feature ships. Switching a stub on is a one-line change
 *     once the M8 / AI / gym-buddy endpoints land.
 */
export type EntitlementFeature =
  | "create_workout"
  | "ai_workout"
  | "gym_buddy"
  | "unlimited_exercise_library"
  | "trainer_clients";

/**
 * Spec-narrow tier-name union. Reflects the simplified tier catalog
 * (post `20260526120000_simplify_tier_model.sql`): Free + Premium for
 * users, and three trainer tiers by business size (all carrying the
 * former `_pro` entitlements — AI buddy etc.). The `_standard` and
 * `basic` variants were dropped. Unknown tier strings collapse to
 * `'free'` via `coerceTierName` so the wire payload never carries an
 * arbitrary string.
 */
export type SubscriptionTierName =
  | "free"
  | "premium"
  | "individual_trainer"
  | "small_business"
  | "medium_enterprise";

/**
 * Why an entitlement assertion was denied. Mobile uses this to pick the
 * gate-prompt copy:
 *   - `tier`: user is on a tier that has the feature flag disabled
 *     (only reachable through stubs today; e.g. `gym_buddy` on basic).
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
 */
export type EntitlementDenyReason = "tier" | "limit" | "cancelled" | "expired";

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
 *   3. SELECT `subscription_limits` row for `limit_type = 'workouts'`
 *      if the feature requires it (currently only `create_workout`).
 *      Missing row → trigger hasn't ever fired for this user → treat as
 *      `current_count = 0`. The trigger inserts the row lazily on the
 *      first sub change OR first workout insert, so a brand-new user
 *      with no workouts and no sub-row legitimately has no limit row.
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
 *   - `current_count >= effective workout_limit` → deny. Reason is
 *     `'limit'` for an active tier at cap (upgrade_to = cheapest tier
 *     that satisfies, per role), or `'cancelled'` / `'expired'` for a
 *     reverted sub that has also exhausted its free allowance
 *     (upgrade_to = null — reinstate / fix payment instead).
 *   - Otherwise → allowed.
 *
 * Stub features (`ai_workout`, `gym_buddy`, `unlimited_exercise_library`,
 * `trainer_clients`) always return `{ allowed: true }` today. The read
 * path is wired but the verdict short-circuits — see AC 9.5.
 */
export async function assertEntitlement(
  userId: string,
  feature: EntitlementFeature,
): Promise<EntitlementVerdict> {
  // Stub features are accept-all today (AC 9.5). The contract is in
  // place so consumers can call `assertEntitlement(uid, 'ai_workout')`
  // already; flipping the stub off when the AI endpoint ships is a
  // one-line change inside this branch.
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

  // 5. Read the trigger-maintained current usage. If no row, the user
  //    has never had a sub-change AND never inserted a workout — both
  //    are "0 used" states.
  const limitRows = await db
    .select({
      currentCount: subscriptionLimits.currentCount,
    })
    .from(subscriptionLimits)
    .where(
      and(
        eq(subscriptionLimits.userId, userId),
        eq(subscriptionLimits.limitType, "workouts"),
        // Mirror the month-boundary filter the trigger uses on writes
        // (`increment_usage_limit` in 004_subscriptions_and_roles.sql).
        // Without this filter, a free user who hit cap in month N is read
        // as at-cap in month N+1 — denying the next workout before the
        // trigger ever gets a chance to reset the row. There is no
        // scheduled invocation of `reset_monthly_limits()` so the row
        // stays stale forever; the user is locked out until they upgrade
        // (Inspector Brad PR #72 high-severity find — sweep #1).
        gte(subscriptionLimits.resetDate, currentMonthStartUtc()),
      ),
    )
    .limit(1);

  // Missing current-month row ⇒ user has no usage this month ⇒ count = 0.
  const currentCount = limitRows[0]?.currentCount ?? 0;

  if (currentCount >= workoutLimit) {
    return buildDenyVerdict({
      // 'limit' for an active tier at cap; 'cancelled' / 'expired' for a
      // reverted sub that has also used up its free allowance.
      reason: denyReason,
      currentTier: effectiveTierName,
      role,
    });
  }

  return { allowed: true };
}

// ─── Pure helpers (exported for testing) ──────────────────────────────

/**
 * UTC-midnight of the first day of the current month. Used as the lower
 * bound on `subscription_limits.reset_date` to filter out stale rows from
 * prior months. Matches `date_trunc('month', NOW())` semantics in
 * Postgres; the trigger's UTC-month-boundary comparison and this helper
 * agree on the same instant.
 */
export function currentMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

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
    case "individual_trainer":
    case "small_business":
    case "medium_enterprise":
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
 * Pick the upgrade target for a `create_workout` deny. Post tier-
 * simplification the picks are:
 *   - `user` (and `physiotherapist`, treated as user-role today)
 *     → `'premium'` (£12.99 / month — only paid user tier).
 *   - `personal_trainer` → `'individual_trainer'` (£14.99 / month —
 *     smallest trainer tier).
 *   - `admin` → no upgrade target (admins shouldn't be denied; if they
 *     somehow are, the gate prompt has nothing useful to suggest).
 *
 * Returns `null` to signal "no sensible upgrade", which mobile renders
 * as a generic "contact support" CTA.
 */
export function pickUpgradeTier(
  role: "user" | "personal_trainer" | "physiotherapist" | "admin",
): SubscriptionTierName | null {
  if (role === "personal_trainer") return "individual_trainer";
  if (role === "admin") return null;
  // user + physiotherapist fall through to user-tier upgrade.
  return "premium";
}

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
  priceMonthly: number | null;
}

/**
 * Load tier metadata by name. Returns `null` when the row doesn't exist
 * — caller treats that as "fall back to free" or throws if free itself
 * is missing.
 */
async function loadTier(db: Db, tierName: string): Promise<TierMeta | null> {
  const rows = await db
    .select({
      tierName: subscriptionTiers.tierName,
      workoutLimit: subscriptionTiers.workoutLimit,
      priceMonthly: subscriptionTiers.priceMonthly,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, tierName))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    tierName: row.tierName,
    workoutLimit: row.workoutLimit ?? null,
    priceMonthly: parsePriceDecimal(row.priceMonthly),
  };
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
}): Promise<Extract<EntitlementVerdict, { allowed: false }>> {
  const { reason, currentTier, role } = input;

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

  const upgradeTierName = pickUpgradeTier(role);
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
