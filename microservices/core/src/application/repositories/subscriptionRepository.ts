import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  profiles,
  subscriptionTiers,
  userSubscriptions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Subscription `payment_status` values that grant LIVE entitlement — the
 * single source of truth, mirroring the `user_subscriptions_active_unique`
 * partial index in schema.ts (`payment_status IN ('active','pending',
 * 'trialing','past_due')`). Only these resolve the user's tier; cancelled /
 * expired / incomplete subscriptions must fall back to the free tier rather
 * than reporting a lapsed entitlement. Consumed here by `findForUser` and by
 * `trainerRepository.getTrainerClientLimit`.
 */
export const LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "pending",
  "trialing",
  "past_due",
] as const;

/**
 * WHERE predicate for a *currently-live* `user_subscriptions` row: a live
 * payment status AND not past its expiry. The DB's `get_user_subscription()`
 * (which drives the `update_subscription_limits` role-sync trigger) requires
 * `expires_at IS NULL OR expires_at > NOW()`; this mirrors that so the API and
 * the trigger agree on what "live" means.
 *
 * Without the expiry guard an expired-but-never-transitioned `trialing` row
 * (the Stripe status transition never fired) reads as live here, so
 * `isTrainerTier` resolves true and the mobile app enables coach mode — while
 * the DB function excludes the same row, leaves `profiles.role` un-elevated,
 * and every coach endpoint 403s. (Staging: a 4-month-expired `trialing`
 * `individual_trainer` row produced exactly this trap.)
 *
 * A `cancelled` row is also live during its grace window — until the paid
 * period ends (`expires_at` in the future). This mirrors the DB function's
 * `(payment_status = 'cancelled' AND expires_at IS NOT NULL AND expires_at >
 * NOW())` branch, so a user who cancels keeps their tier (and trainer
 * entitlement) until the period they paid for actually lapses, rather than
 * being dropped to free the instant they cancel. A cancelled row with no
 * `expires_at` is treated as lapsed (no open-ended grace).
 */
/**
 * A Postgres "invalid input syntax for type uuid" error (SQLSTATE `22P02`),
 * raised when a non-UUID string is compared against a `uuid` column. Matched
 * on the SQLSTATE code, falling back to the message text if the driver doesn't
 * surface `code`. Used to distinguish a genuinely-not-a-user id (skip) from a
 * transient DB failure (must propagate + retry).
 */
function isInvalidUuidError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "22P02") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /invalid input syntax for type uuid/i.test(message);
}

export function liveSubscriptionFilter(): SQL {
  const notExpired = sql`(${userSubscriptions.expiresAt} IS NULL OR ${userSubscriptions.expiresAt} > NOW())`;
  return and(
    or(
      inArray(userSubscriptions.paymentStatus, [...LIVE_SUBSCRIPTION_STATUSES]),
      and(
        eq(userSubscriptions.paymentStatus, "cancelled"),
        isNotNull(userSubscriptions.expiresAt),
        sql`${userSubscriptions.expiresAt} > NOW()`,
      ),
    ),
    notExpired,
  ) as SQL;
}

/**
 * Drizzle-inferred row type for `user_subscriptions`. Includes every column
 * (id, user_id, tier_name, payment_status, expires_at, …, metadata, …).
 */
export type UserSubscription = typeof userSubscriptions.$inferSelect;

/**
 * Sub-tier-status names that match the spec's `SubscriptionStatus` enum.
 * Used by `MySubscription` shaping only — repository emits the raw
 * `payment_status` text from the column and lets the handler-level
 * coercion happen at the wire boundary.
 */
export type MySubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

/**
 * Wire-shape `MySubscription`. Mirrors specs/11-payments-subscriptions/
 * design.md § Domain models. Synthesised free shape when the user has
 * no `user_subscriptions` row → `subscriptionId: null`.
 */
export interface MySubscription {
  // From user_subscriptions
  subscriptionId: string | null;
  tierName: string;
  paymentStatus: string;
  billingCycle: "monthly" | "yearly" | null;
  startsAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  trialEndsAt: string | null;
  externalSubscriptionId: string | null;

  // From subscription_tiers (joined)
  tierDisplayName: string;
  tierDescription: string | null;
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;

  // From profiles
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";

  // Trial eligibility (read from profiles.has_used_*_trial)
  hasUsedUserTrial: boolean;
  hasUsedTrainerTrial: boolean;
  isEligibleForUserTrial: boolean;
  isEligibleForTrainerTrial: boolean;

  // Scheduled-change marker (read from user_subscriptions.metadata.scheduled_change)
  scheduledChange: {
    nextTierName: string;
    nextDisplayName: string;
    effectiveAt: string;
  } | null;
}

/**
 * Drizzle-inferred insert type. All columns required except those with
 * defaults (id, currency, payment_status, starts_at, billing_cycle,
 * metadata, timestamps) — Drizzle marks those optional.
 */
export type NewUserSubscription = typeof userSubscriptions.$inferInsert;

/**
 * Repository for `user_subscriptions` reads + writes.
 *
 * **Critical contract**: writes here MUST NOT touch
 *  - `profiles.subscription_id`
 *  - `profiles.role`
 *  - `subscription_limits.*`
 *
 * Those columns are maintained by the Postgres trigger
 * `update_subscription_limits_trigger` (see
 * `supabase/migrations/004_subscriptions_and_roles.sql` line 438+),
 * which fires AFTER INSERT OR UPDATE on this table and propagates the
 * derived state automatically. Touching them from handler code would
 * race against the trigger and corrupt the derived state.
 *
 * Pattern matches `ProfileRepository` — methods are async, take typed
 * primary identifiers as the first parameter, return `null` for missing
 * rows rather than throwing.
 */
export class SubscriptionRepository {
  static readonly key = "SubscriptionRepository";

  /**
   * Does a `profiles` row exist for this id?
   *
   * RevenueCat's `app_user_id` is the Supabase user UUID, and
   * `user_subscriptions.user_id` is a FK to `profiles.id`. A SHARED RevenueCat
   * project (staging + production behind one project) fans every event out to
   * every configured webhook, so this backend can receive events for a user
   * that only exists in the OTHER environment's database. `syncCustomer` calls
   * this before writing so a foreign id is skipped instead of tripping the FK
   * and 500-looping forever on RevenueCat's at-least-once retries.
   *
   * A non-UUID id resolves to `false` (Postgres 22P02 cast failure) — it can't
   * be one of our users. Any OTHER error (transient Neon blip, connection
   * reset) is RETHROWN so the webhook 500s and RevenueCat retries, rather than
   * silently skipping a real user's purchase and dedup-swallowing every retry.
   */
  async userExists(userId: string): Promise<boolean> {
    const db = getDb();
    try {
      const rows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      return rows.length > 0;
    } catch (err) {
      if (isInvalidUuidError(err)) return false;
      throw err;
    }
  }

  /**
   * Find by the Stripe-assigned `external_subscription_id` (`sub_…`).
   * Used by webhook handlers to locate the local row from a Stripe
   * subscription event. Returns `null` if no row matches — the webhook
   * handler logs a warning and skips when this happens (e.g. an event
   * for a subscription that was created out-of-band).
   *
   * Stripe IDs are immutable per subscription, so this is the canonical
   * lookup; querying by `user_id` is unreliable when a user has multiple
   * subscriptions in their history (cancelled + reactivated, upgrade-
   * caused replacements, etc.).
   */
  async findByExternalId(
    externalSubscriptionId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(
        eq(userSubscriptions.externalSubscriptionId, externalSubscriptionId),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Find the user's most recent subscription row regardless of status.
   * Used by the outbound `POST /subscriptions` endpoint to detect
   * reinstatement vs. subscription change — both branches need to see
   * whatever the user's latest sub looked like, including cancelled
   * ones (you can reinstate a cancelled sub) and trialing ones (grace-
   * period reinstatement).
   *
   * Returns `null` when the user has never had a subscription (fresh
   * user → caller proceeds with insert path).
   */
  async findMostRecentForUser(
    userId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Fetch ALL `user_subscriptions` rows for a user that carry a Stripe
   * subscription id (`sub_…`), regardless of local `payment_status`.
   *
   * Used by account deletion to cancel every Stripe-billed subscription
   * before purging the rows. We deliberately do NOT filter on local status:
   * `cancelLiveSubscriptions` (the RevenueCat sync) flips `payment_status`
   * to 'cancelled' WITHOUT calling Stripe, so a locally-"cancelled" row can
   * still be billing on Stripe. Stripe's own idempotency (resource_missing /
   * already-cancelled) makes re-cancelling a dead sub a safe no-op, so the
   * caller can attempt cancel on every Stripe row. RevenueCat-mirror rows
   * (`rc_…`) are returned too; the caller skips them (Apple IAP can't be
   * cancelled server-side).
   */
  async findStripeSubscriptionIdsForUser(userId: string): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ externalId: userSubscriptions.externalSubscriptionId })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          isNotNull(userSubscriptions.externalSubscriptionId),
        ),
      );
    return rows
      .map((r) => r.externalId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /**
   * Lookup a `user_subscriptions` row by primary key, scoped to the
   * authenticated user. Used by `POST /subscriptions/:id/cancel` to
   * enforce ownership before issuing any Stripe-side cancel — without
   * the `userId` constraint a user could pass another user's row id
   * and trigger a cancellation on their subscription. Returns `null`
   * either when the row doesn't exist OR when it belongs to a different
   * user; the handler maps both to 404 to avoid revealing whether an
   * id exists.
   */
  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(
        and(eq(userSubscriptions.id, id), eq(userSubscriptions.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert a new `user_subscriptions` row, returning the inserted row
   * (including DB-assigned `id` and timestamps). Caller is responsible
   * for ensuring `external_subscription_id` doesn't already exist — the
   * outbound flow checks `findByExternalId` first; the webhook flow
   * checks the same before inserting on subscription.created.
   */
  async insert(data: NewUserSubscription): Promise<UserSubscription> {
    const db = getDb();
    const rows = await db.insert(userSubscriptions).values(data).returning();
    const inserted = rows[0];
    if (!inserted) {
      throw new Error(
        `SubscriptionRepository.insert returned no rows for user ${data.userId}`,
      );
    }
    return inserted;
  }

  /**
   * Update a `user_subscriptions` row by primary key. Returns the
   * updated row, or `null` if no row matched (rare — caller should
   * have located the row first via `findByExternalId`).
   *
   * Bumps `updated_at` automatically — the column has a default of
   * `now()` but it's an INSERT default only; UPDATE needs us to set
   * it explicitly so the value advances on mutation.
   */
  async updateById(
    id: string,
    data: Partial<Omit<UserSubscription, "id" | "createdAt">>,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .update(userSubscriptions)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Insert a `user_subscriptions` row, or update the existing row that carries
   * the same `external_subscription_id`, in a SINGLE atomic statement
   * (`INSERT ... ON CONFLICT (external_subscription_id) DO UPDATE`).
   *
   * Replaces the non-atomic `findByExternalId` → insert-or-`updateById` dance in
   * the RevenueCat sync, which could double-insert under RevenueCat's
   * at-least-once + UNORDERED delivery: two concurrent FIRST deliveries for the
   * same new customer both read `existing === null` and both insert. The partial
   * unique index `user_subscriptions_external_id_unique` (spec-12.13) makes the
   * second writer take the `DO UPDATE` branch instead of colliding — no more
   * incidental-500 + retry.
   *
   * The conflict target is that partial index; its predicate
   * (`external_subscription_id IS NOT NULL`) is supplied via `targetWhere` so
   * Postgres infers the index rather than erroring on an ambiguous target.
   *
   * CONTRACT — `data.externalSubscriptionId` MUST be non-null. Callers pass a
   * concrete store id (`rc_…` / `sub_…`). A NULL id falls outside the partial
   * index, so `ON CONFLICT` could not dedup it and the row would insert
   * unguarded; we reject it explicitly rather than silently inserting a
   * duplicate-prone free-tier row.
   *
   * On conflict we update ONLY the mutable entitlement fields
   * (tier / status / expiry / billingCycle / cancelledAt / metadata +
   * `updated_at`). We deliberately do NOT overwrite `user_id` or `starts_at`:
   * the conflicting row
   * is the same subscription (the external id encodes it), so its original
   * ownership and start instant are preserved.
   *
   * Does NOT itself enforce the one-live-row-per-user invariant
   * (`user_subscriptions_active_unique`). A caller that may flip a row back to
   * live across rails (the RevenueCat sync) MUST still call
   * `cancelLiveSubscriptions(userId)` first — exactly as the pre-upsert code did
   * — or a sibling live row for the same user would trip that index.
   */
  async upsertByExternalId(
    data: NewUserSubscription & { externalSubscriptionId: string },
  ): Promise<UserSubscription> {
    if (!data.externalSubscriptionId) {
      throw new Error(
        "SubscriptionRepository.upsertByExternalId requires a non-null externalSubscriptionId",
      );
    }
    const db = getDb();
    const rows = await db
      .insert(userSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: userSubscriptions.externalSubscriptionId,
        targetWhere: sql`${userSubscriptions.externalSubscriptionId} IS NOT NULL`,
        set: {
          tierName: data.tierName,
          paymentStatus: data.paymentStatus,
          expiresAt: data.expiresAt,
          billingCycle: data.billingCycle,
          // Reflect the cancelled-but-active flag on re-sync too (e.g. an
          // uncancellation must clear it), not just on first insert.
          cancelledAt: data.cancelledAt ?? null,
          metadata: data.metadata,
          updatedAt: new Date(),
        },
      })
      .returning();
    const upserted = rows[0];
    if (!upserted) {
      throw new Error(
        `SubscriptionRepository.upsertByExternalId returned no rows for external id ${data.externalSubscriptionId}`,
      );
    }
    return upserted;
  }

  /**
   * Cancel every LIVE `user_subscriptions` row for a user (set
   * `payment_status = 'cancelled'`). Used by the RevenueCat webhook sync
   * before inserting a fresh RevenueCat-mirror row, so the new active row
   * doesn't collide with the `user_subscriptions_active_unique` partial index
   * (one live row per user). RevenueCat is the unifying source of truth across
   * both rails, so a prior live row (e.g. a Stripe-created mirror) is safely
   * superseded by the RevenueCat-derived state. No-op when the user has no
   * live rows. Returns the number of rows cancelled.
   */
  async cancelLiveSubscriptions(userId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .update(userSubscriptions)
      .set({ paymentStatus: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          inArray(userSubscriptions.paymentStatus, [
            ...LIVE_SUBSCRIPTION_STATUSES,
          ]),
        ),
      )
      .returning({ id: userSubscriptions.id });
    return rows.length;
  }

  /**
   * Fetch the user's current subscription joined with the tier + the
   * profile's role + trial-eligibility flags. Returns a synthesised
   * `free`-tier shape when the user has no `user_subscriptions` row,
   * so the caller never has to handle a null sub specially (matches
   * the contract in design.md § Backend endpoints > GET /subscriptions/me).
   *
   * Query strategy:
   *   1. SELECT profile row (we need it regardless for role + trial flags).
   *      Returns `null` if no profile (handler maps to 500 — JWT was
   *      verified but the profile is missing → schema corruption).
   *   2. JOIN user_subscriptions (LIVE statuses only — see
   *      LIVE_SUBSCRIPTION_STATUSES — ordered by createdAt DESC, latest
   *      row only) with subscription_tiers (INNER on tier_name).
   *      Returns 0 or 1 rows; a lapsed-only user yields 0 → free tier.
   *   3. If no sub row → look up the `free` tier metadata separately
   *      and synthesise the response. The free tier MUST exist in the
   *      seeded catalog; missing it is a deploy-misconfig 500 condition.
   *
   * Trigger contract: this method is read-only. NEVER writes to
   * `profiles.subscription_id`, `profiles.role`, `subscription_limits.*`,
   * or any column maintained by `update_subscription_limits_trigger`.
   */
  async findForUser(userId: string): Promise<MySubscription | null> {
    const db = getDb();

    // 1. Profile slice — role + trial flags + sanity check the user exists.
    const profileRows = await db
      .select({
        role: profiles.role,
        hasUsedUserTrial: profiles.hasUsedUserTrial,
        hasUsedTrainerTrial: profiles.hasUsedTrainerTrial,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const profile = profileRows[0];
    if (!profile) {
      // Shouldn't normally happen — JWT bound user with no profile row.
      // Surface as `null` so the handler maps to 404 / 500 per its
      // discretion (we choose 500 in the handler — profile missing is
      // a schema corruption rather than a "no such user").
      return null;
    }

    const hasUsedUserTrial = profile.hasUsedUserTrial ?? false;
    const hasUsedTrainerTrial = profile.hasUsedTrainerTrial ?? false;
    const role = normaliseRole(profile.role);

    // 2. Sub row joined with tier — LEFT JOIN tiers gives us the
    // human-readable display name + feature flags in one round-trip.
    const subRows = await db
      .select({
        // user_subscriptions columns
        subscriptionId: userSubscriptions.id,
        tierName: userSubscriptions.tierName,
        paymentStatus: userSubscriptions.paymentStatus,
        billingCycle: userSubscriptions.billingCycle,
        startsAt: userSubscriptions.startsAt,
        expiresAt: userSubscriptions.expiresAt,
        cancelledAt: userSubscriptions.cancelledAt,
        trialEndsAt: userSubscriptions.trialEndsAt,
        externalSubscriptionId: userSubscriptions.externalSubscriptionId,
        metadata: userSubscriptions.metadata,
        // subscription_tiers columns (joined)
        tierDisplayName: subscriptionTiers.displayName,
        tierDescription: subscriptionTiers.description,
        workoutLimit: subscriptionTiers.workoutLimit,
        aiAccess: subscriptionTiers.aiAccess,
        aiWorkoutLimit: subscriptionTiers.aiWorkoutLimit,
        gymBuddyAccess: subscriptionTiers.gymBuddyAccess,
        trainerClientLimit: subscriptionTiers.trainerClientLimit,
        isTrainerTier: subscriptionTiers.isTrainerTier,
      })
      .from(userSubscriptions)
      .innerJoin(
        subscriptionTiers,
        eq(userSubscriptions.tierName, subscriptionTiers.tierName),
      )
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          // Only LIVE, non-expired subscriptions resolve the user's tier. A
          // trainer who cancelled (most-recent row is `cancelled`/`expired`) or
          // whose trial lapsed must NOT keep reporting their old tier —
          // otherwise `isTrainerTier` / `trainerClientLimit` / `workoutLimit`
          // stay set after lapse and the mobile app leaves coach mode enabled.
          // The expiry half of the guard mirrors the DB's
          // get_user_subscription() so the app and the role-sync trigger agree.
          // Excluded rows fall through to the synthesised free tier below.
          liveSubscriptionFilter(),
        ),
      )
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);

    const subRow = subRows[0];

    if (!subRow) {
      // Synthesise a free-tier shape. The free tier MUST exist in the
      // catalog (seeded by migration 004_subscriptions_and_roles.sql).
      const freeTierRows = await db
        .select()
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.tierName, "free"))
        .limit(1);

      const free = freeTierRows[0];
      if (!free) {
        // Deploy misconfig — the free tier should ALWAYS be seeded.
        // Throw so the handler returns 500 with the structured log
        // pointing operators at the catalog.
        throw new Error(
          "subscription_tiers.tier_name='free' row not found — catalog is missing the default free tier (deploy misconfiguration)",
        );
      }

      return {
        subscriptionId: null,
        tierName: free.tierName,
        paymentStatus: "active", // free tier is always "active"
        billingCycle: null,
        startsAt: toIsoString(new Date()), // synth: starts "now"
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        externalSubscriptionId: null,
        tierDisplayName: free.displayName,
        tierDescription: free.description ?? null,
        workoutLimit: free.workoutLimit ?? null,
        aiAccess: free.aiAccess === true,
        aiWorkoutLimit: free.aiWorkoutLimit ?? 0,
        gymBuddyAccess: free.gymBuddyAccess === true,
        trainerClientLimit: free.trainerClientLimit ?? null,
        isTrainerTier: free.isTrainerTier === true,
        role,
        hasUsedUserTrial,
        hasUsedTrainerTrial,
        isEligibleForUserTrial: !hasUsedUserTrial,
        isEligibleForTrainerTrial: !hasUsedTrainerTrial,
        scheduledChange: null,
      };
    }

    // Resolve the scheduled-change marker if present. Shape:
    //   metadata.scheduled_change: { next_tier_name, effective_at }
    // Resolves `next_display_name` via a lookup on subscription_tiers.
    const scheduledChange = await resolveScheduledChange(
      subRow.metadata as Record<string, unknown> | null,
    );

    return {
      subscriptionId: subRow.subscriptionId,
      tierName: subRow.tierName,
      paymentStatus: subRow.paymentStatus ?? "pending",
      billingCycle: normaliseBillingCycle(subRow.billingCycle),
      startsAt: toIsoString(subRow.startsAt),
      expiresAt: toOptionalIsoString(subRow.expiresAt),
      cancelledAt: toOptionalIsoString(subRow.cancelledAt),
      trialEndsAt: toOptionalIsoString(subRow.trialEndsAt),
      externalSubscriptionId: subRow.externalSubscriptionId ?? null,
      tierDisplayName: subRow.tierDisplayName,
      tierDescription: subRow.tierDescription ?? null,
      workoutLimit: subRow.workoutLimit ?? null,
      aiAccess: subRow.aiAccess === true,
      aiWorkoutLimit: subRow.aiWorkoutLimit ?? 0,
      gymBuddyAccess: subRow.gymBuddyAccess === true,
      trainerClientLimit: subRow.trainerClientLimit ?? null,
      isTrainerTier: subRow.isTrainerTier === true,
      role,
      hasUsedUserTrial,
      hasUsedTrainerTrial,
      isEligibleForUserTrial: !hasUsedUserTrial,
      isEligibleForTrainerTrial: !hasUsedTrainerTrial,
      scheduledChange,
    };
  }
}

// ─── Pure helpers (exported for testing) ──────────────────────────────

/**
 * Coerce the `profiles.role` column to the spec's narrow enum. Defaults
 * to "user" when the column is null / unrecognised — matches the
 * defensive coercion in `profileRepository.getProfileSlice`.
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
 * Coerce the `user_subscriptions.billing_cycle` column to the spec's
 * narrow enum. Returns null for missing / unrecognised values so the
 * UI knows the cycle is unset (legacy / synthesised free rows have no
 * cycle).
 */
export function normaliseBillingCycle(
  cycle: string | null | undefined,
): "monthly" | "yearly" | null {
  if (cycle === "monthly" || cycle === "yearly") return cycle;
  return null;
}

/**
 * Resolve the scheduled-change marker on a user_subscriptions row.
 * Shape on the row:
 *   metadata.scheduled_change: { next_tier_name: string, effective_at: ISO }
 *
 * Looks up `next_display_name` from `subscription_tiers` so the UI can
 * render "Scheduled: <Display Name> (effective <date>)" without a
 * separate round-trip. Returns null when:
 *   - metadata is null / missing the marker
 *   - the marker shape is malformed (defensive — out-of-band edit)
 *   - the referenced tier doesn't exist in the catalog
 */
export async function resolveScheduledChange(
  metadata: Record<string, unknown> | null,
): Promise<{
  nextTierName: string;
  nextDisplayName: string;
  effectiveAt: string;
} | null> {
  if (metadata === null || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).scheduled_change;
  if (raw === null || typeof raw !== "object") return null;
  const marker = raw as Record<string, unknown>;
  const nextTierName = marker.next_tier_name;
  const effectiveAt = marker.effective_at;
  if (
    typeof nextTierName !== "string" ||
    nextTierName.length === 0 ||
    typeof effectiveAt !== "string" ||
    effectiveAt.length === 0
  ) {
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({ displayName: subscriptionTiers.displayName })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, nextTierName))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    nextTierName,
    nextDisplayName: row.displayName,
    effectiveAt,
  };
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function toOptionalIsoString(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const iso = toIsoString(value);
  return iso.length === 0 ? null : iso;
}
