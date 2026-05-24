import { and, desc, eq } from "drizzle-orm";
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
 * Spec-narrow tier-name union. Mirrors the seed catalog from
 * `supabase/migrations/004_subscriptions_and_roles.sql`. Unknown
 * tier strings collapse to `'free'` via `coerceTierName` so the wire
 * payload never carries an arbitrary string.
 */
export type SubscriptionTierName =
  | "free"
  | "basic"
  | "premium"
  | "individual_trainer_standard"
  | "individual_trainer_pro"
  | "small_business_standard"
  | "small_business_pro"
  | "medium_enterprise_standard"
  | "medium_enterprise_pro";

/**
 * Why an entitlement assertion was denied. Mobile uses this to pick the
 * gate-prompt copy:
 *   - `tier`: user is on a tier that has the feature flag disabled
 *     (only reachable through stubs today; e.g. `gym_buddy` on basic).
 *   - `limit`: feature flag is on but the per-month counter is at cap.
 *   - `cancelled`: sub was cancelled and the grace expires_at has
 *     passed — user reverts to free tier rules, but mobile shows the
 *     "your sub was cancelled" CTA rather than "upgrade".
 *   - `expired`: payment_status indicates failure (`past_due`, `unpaid`,
 *     `incomplete_expired`) — user needs to update payment, not pick a
 *     new tier.
 */
export type EntitlementDenyReason =
  | "tier"
  | "limit"
  | "cancelled"
  | "expired";

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
 *     `expires_at` OR `expires_at <= NOW()`) → deny with reason
 *     `'cancelled'` (for cancelled) or `'expired'` (for past_due /
 *     unpaid / incomplete_expired). Cancelled-with-future-expires_at is
 *     treated as still entitled until that expiry — the user paid
 *     through that date.
 *   - `tier.workout_limit IS NULL` → unlimited → allowed.
 *   - `current_count >= tier.workout_limit` → deny with reason
 *     `'limit'`, upgrade_to = cheapest tier that satisfies (per role).
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

  // 3. Status check BEFORE the count check — a cancelled or expired
  //    sub should produce the cancelled/expired reason rather than
  //    misleadingly being denied for 'limit'. Mobile picks different
  //    copy for each branch.
  if (subRow !== null) {
    const statusDeny = classifySubscriptionStatus(
      subRow.paymentStatus,
      subRow.expiresAt,
    );
    if (statusDeny !== null) {
      return buildDenyVerdict({
        reason: statusDeny,
        currentTier: effectiveTierName,
        role,
      });
    }
  }

  // 4. Tier with no workout limit → unlimited. Free has limit=3 by
  //    default; basic/premium/all-trainer tiers have NULL = unlimited.
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
      ),
    )
    .limit(1);

  const currentCount = limitRows[0]?.currentCount ?? 0;

  if (currentCount >= workoutLimit) {
    return buildDenyVerdict({
      reason: "limit",
      currentTier: effectiveTierName,
      role,
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
    case "basic":
    case "premium":
    case "individual_trainer_standard":
    case "individual_trainer_pro":
    case "small_business_standard":
    case "small_business_pro":
    case "medium_enterprise_standard":
    case "medium_enterprise_pro":
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
 * Pick the upgrade target for a `create_workout` deny. Cheapest tier
 * that lifts the user above the limit, picked by role:
 *   - `user` (and `physiotherapist`, treated as user-role today)
 *     → `'basic'` (£7.99 / month, unlimited workouts).
 *   - `personal_trainer` → `'individual_trainer_standard'`
 *     (£9.99 / month, unlimited workouts).
 *   - `admin` → no upgrade target (admins shouldn't be denied; if they
 *     somehow are, the gate prompt has nothing useful to suggest).
 *
 * Returns `null` to signal "no sensible upgrade", which mobile renders
 * as a generic "contact support" CTA.
 */
export function pickUpgradeTier(
  role: "user" | "personal_trainer" | "physiotherapist" | "admin",
): SubscriptionTierName | null {
  if (role === "personal_trainer") return "individual_trainer_standard";
  if (role === "admin") return null;
  // user + physiotherapist fall through to user-tier upgrade.
  return "basic";
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
