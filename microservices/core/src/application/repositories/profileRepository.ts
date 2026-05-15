import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  achievements,
  profiles,
  ptClientRelationships,
  subscriptionTiers,
  userAchievements,
  userSubscriptions,
  workoutSessions,
  type Profile,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  computeIsFreeTier,
  normaliseSubscriptionStatus,
  type SubscriptionRow,
  type SubscriptionStatus,
} from "./dashboardRepository";

/**
 * Wire shape for the profile page's profile slice. Fields are normalised
 * for the mobile presenter — numeric strings from Drizzle's `decimal`
 * type are coerced to JS `number | null`, dates to ISO strings, and
 * `preferredUnits` is constrained to the two values the UI cares about.
 *
 * `email` is sourced from the JWT, not the `profiles` row — the column
 * exists in Supabase but is treated as authoritative-via-auth elsewhere
 * in the codebase. We surface it through this slice for the UI's
 * convenience; falls back to `profiles.email` if the column is set.
 */
export interface ProfilePageProfileSlice {
  id: string;
  fullName: string | null;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
  heightCm: number | null;
  weightKg: number | null;
  preferredUnits: "metric" | "imperial";
  isProfilePublic: boolean;
  createdAt: string;
}

/**
 * Wire shape for the profile page's subscription slice. Superset of
 * `DashboardSubscription` — adds `expiresAt`, `cancelledAt`,
 * `workoutLimit`, `tierDisplayName`, and `isUnlimited` because the
 * subscription card on the profile page surfaces all of them.
 */
export interface ProfilePageSubscriptionSlice {
  tierName: string | null;
  tierDisplayName: string | null;
  status: SubscriptionStatus | null;
  isFreeTier: boolean;
  isTrainerTier: boolean;
  expiresAt: string | null;
  cancelledAt: string | null;
  workoutLimit: number | null;
  isUnlimited: boolean;
}

export interface ProfilePageAchievement {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  unlockedAt: string;
}

export interface ProfilePageTrainerRef {
  id: string;
  trainer: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
}

/**
 * Full `/profile/page` envelope. See specs/milestones/M6-profile/BACKEND_BRIEF.md.
 *
 * Single round-trip aggregation — frontend caches this whole shape in
 * SQLite under a single key, no nested pagination. New fields (e.g.
 * trainer-side stats for M8) should land as **optional** top-level keys
 * so the v1 contract stays back-compat.
 */
export interface ProfilePageData {
  profile: ProfilePageProfileSlice;
  subscription: ProfilePageSubscriptionSlice;
  stats: {
    workoutsCompleted: number;
  };
  recentAchievements: ProfilePageAchievement[];
  activeTrainers: ProfilePageTrainerRef[];
  pendingTrainerRequests: ProfilePageTrainerRef[];
}

const RECENT_ACHIEVEMENTS_LIMIT = 3;

/**
 * Title-case a snake_case tier identifier for display.
 *
 *   "premium_annual" → "Premium Annual"
 *   "free"           → "Free"
 *
 * Pure — exported for unit testing without seeding a DB.
 */
export function formatTierDisplayName(tierName: string | null): string | null {
  if (tierName === null) return null;
  const trimmed = tierName.trim();
  if (trimmed.length === 0) return null;
  return trimmed
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Convert a Drizzle `decimal` value (returned as string) to `number | null`.
 * Mirrors `dashboardRepository.coerceNumeric` but stays local so this
 * module doesn't depend on the dashboard repo's internal name.
 */
function coerceDecimal(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: Date | string | null): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  const iso = toIsoString(value);
  return iso.length === 0 ? null : iso;
}

export class ProfileRepository {
  static readonly key = "ProfileRepository";

  async getById(userId: string): Promise<Profile | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    return result[0] ?? null;
  }

  async update(
    userId: string,
    data: Partial<Omit<Profile, "id" | "createdAt">>,
  ): Promise<Profile | null> {
    const db = getDb();

    const result = await db
      .update(profiles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, userId))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Assemble the full `/profile/page` payload via parallel sub-queries.
   * Returns `null` when the profile row doesn't exist — handler maps
   * to 404. Subscription / achievements / trainers default to empty /
   * free-tier defaults when their tables yield no rows.
   *
   * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
   */
  async getProfilePageData(userId: string): Promise<ProfilePageData | null> {
    const profileSlice = await this.getProfileSlice(userId);
    if (profileSlice === null) return null;

    const [
      subscription,
      workoutsCompleted,
      recentAchievements,
      activeTrainers,
      pendingTrainerRequests,
    ] = await Promise.all([
      this.getSubscriptionSlice(userId),
      this.getWorkoutsCompletedCount(userId),
      this.getRecentAchievements(userId, RECENT_ACHIEVEMENTS_LIMIT),
      this.getTrainerRelationships(userId, "active"),
      this.getTrainerRelationships(userId, "pending"),
    ]);

    return {
      profile: profileSlice,
      subscription,
      stats: { workoutsCompleted },
      recentAchievements,
      activeTrainers,
      pendingTrainerRequests,
    };
  }

  /**
   * Profile slice: explicit projection + ISO/number normalisation.
   * Returns `null` when the row doesn't exist. The handler treats `null`
   * as 404.
   */
  async getProfileSlice(
    userId: string,
  ): Promise<ProfilePageProfileSlice | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        username: profiles.username,
        avatarUrl: profiles.avatarUrl,
        role: profiles.role,
        fitnessLevel: profiles.fitnessLevel,
        heightCm: profiles.heightCm,
        weightKg: profiles.weightKg,
        preferredUnits: profiles.preferredUnits,
        isProfilePublic: profiles.isProfilePublic,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      fullName: row.fullName ?? null,
      email: row.email ?? null,
      username: row.username ?? null,
      avatarUrl: row.avatarUrl ?? null,
      // Defensive default to "user" — column is nullable in Supabase but
      // the UI assumes a value. Anything outside the enum collapses to
      // "user" rather than crashing the presenter.
      role:
        row.role === "personal_trainer" ||
        row.role === "physiotherapist" ||
        row.role === "admin"
          ? row.role
          : "user",
      fitnessLevel: row.fitnessLevel ?? null,
      heightCm: coerceDecimal(row.heightCm),
      weightKg: coerceDecimal(row.weightKg),
      preferredUnits: row.preferredUnits === "imperial" ? "imperial" : "metric",
      isProfilePublic: row.isProfilePublic === true,
      createdAt: toIsoString(row.createdAt),
    };
  }

  /**
   * Subscription slice with the extra fields the profile card needs
   * (expiresAt, cancelledAt, workoutLimit, isUnlimited). Re-uses
   * `dashboardRepository.computeIsFreeTier` + `normaliseSubscriptionStatus`
   * so the free-tier rule and status enum stay in one place.
   *
   * No subscription row → free-tier defaults. Multiple rows → the most
   * recently created one (matches dashboard's ORDER BY createdAt DESC).
   */
  async getSubscriptionSlice(
    userId: string,
  ): Promise<ProfilePageSubscriptionSlice> {
    const db = getDb();
    const rows = await db
      .select({
        tierName: userSubscriptions.tierName,
        paymentStatus: userSubscriptions.paymentStatus,
        expiresAt: userSubscriptions.expiresAt,
        cancelledAt: userSubscriptions.cancelledAt,
        isTrainerTier: subscriptionTiers.isTrainerTier,
        tierDbName: subscriptionTiers.tierName,
        // `display_name` is the authoritative human-readable label
        // (e.g. "Small Business Trainer Standard") — the title-cased
        // tier_name diverges from it for trainer/business tiers seeded
        // in 004_subscriptions_and_roles.sql. Prefer this when present,
        // fall back to `formatTierDisplayName` for legacy rows without
        // it.
        tierDisplayName: subscriptionTiers.displayName,
        tierFeatures: subscriptionTiers.features,
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

    const row = rows[0] ?? null;

    if (row === null) {
      return {
        tierName: null,
        tierDisplayName: null,
        status: null,
        isFreeTier: true,
        isTrainerTier: false,
        expiresAt: null,
        cancelledAt: null,
        workoutLimit: null,
        isUnlimited: false,
      };
    }

    const subscriptionRow: SubscriptionRow = {
      tierName: row.tierName ?? null,
      paymentStatus: row.paymentStatus ?? null,
      expiresAt: row.expiresAt ?? null,
      cancelledAt: row.cancelledAt ?? null,
      isTrainerTier: row.isTrainerTier ?? null,
      tierDbName: row.tierDbName ?? null,
    };

    const tierName = row.tierName ?? null;
    const isFreeTier = computeIsFreeTier(subscriptionRow);
    const features = (row.tierFeatures ?? {}) as Record<string, unknown>;
    const workoutsFeature = features.workouts;
    // A user whose subscription has lapsed to free-tier semantics
    // (computeIsFreeTier=true via cancelled+expired) is on the free
    // quota regardless of what their *former* paid tier promised.
    // Coupling `isUnlimited` to the effective tier here keeps the
    // presenter coherent — "Free Tier" + "Unlimited workouts" was
    // an impossible state that the previous code emitted.
    const isUnlimited =
      !isFreeTier &&
      (workoutsFeature === "unlimited" || row.workoutLimit === null);

    return {
      tierName,
      // Prefer the joined display_name; only fall back to the
      // title-cased tier_name when the join returned no display_name
      // (legacy rows, or a deleted/orphaned subscription_tiers row).
      tierDisplayName: row.tierDisplayName ?? formatTierDisplayName(tierName),
      status: normaliseSubscriptionStatus(row.paymentStatus ?? null),
      isFreeTier,
      isTrainerTier: row.isTrainerTier === true,
      expiresAt: toOptionalIsoString(row.expiresAt),
      cancelledAt: toOptionalIsoString(row.cancelledAt),
      workoutLimit: row.workoutLimit ?? null,
      isUnlimited,
    };
  }

  /**
   * Count of completed workout sessions for the user. Counts rows where
   * `status = 'completed'` — sessions in `in_progress` or `cancelled`
   * are excluded.
   */
  async getWorkoutsCompletedCount(userId: string): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
        ),
      );
    return result[0]?.total ?? 0;
  }

  /**
   * Most recently unlocked achievements for the user, capped at `limit`.
   * Joins `user_achievements` to `achievements` for the display fields.
   */
  async getRecentAchievements(
    userId: string,
    limit: number,
  ): Promise<ProfilePageAchievement[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: achievements.id,
        name: achievements.name,
        description: achievements.description,
        iconUrl: achievements.iconUrl,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .innerJoin(
        achievements,
        eq(userAchievements.achievementId, achievements.id),
      )
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.unlockedAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      iconUrl: row.iconUrl ?? null,
      unlockedAt: toIsoString(row.unlockedAt),
    }));
  }

  /**
   * Fetch trainer relationships for the caller as the *client*, scoped
   * to a single status ('active' | 'pending') and excluding AI trainer
   * rows. The exclusion is load-bearing — the legacy memory note
   * (`feature_pt_relationships`) says AI trainer relationships are
   * stored in the same table but must never surface in the Profile UI.
   *
   * `is_ai_trainer` is nullable (column-level `DEFAULT false` backfills
   * inserts, but external/manual inserts can leave it NULL). A naive
   * `is_ai_trainer = false` predicate evaluates to NULL for those rows
   * — Postgres treats NULL as not-true, so the row silently disappears
   * from the user's "Active Trainers" list. The safer reading of
   * "exclude AI trainers" is "exclude rows where the flag is explicitly
   * true" — i.e. NULL counts as not-an-AI-trainer. Codified as the
   * helper below so the same predicate could be reused if more callers
   * need it later.
   *
   * Per-row shape mirrors the legacy `useGetProfile` payload:
   *   { id: relationshipId, trainer: { id, fullName, avatarUrl } }
   */
  async getTrainerRelationships(
    userId: string,
    status: "active" | "pending",
  ): Promise<ProfilePageTrainerRef[]> {
    const db = getDb();
    const notAiTrainer = or(
      eq(ptClientRelationships.isAiTrainer, false),
      isNull(ptClientRelationships.isAiTrainer),
    ) as SQL;

    const rows = await db
      .select({
        relationshipId: ptClientRelationships.id,
        trainerId: profiles.id,
        trainerFullName: profiles.fullName,
        trainerAvatarUrl: profiles.avatarUrl,
      })
      .from(ptClientRelationships)
      .innerJoin(profiles, eq(ptClientRelationships.trainerId, profiles.id))
      .where(
        and(
          eq(ptClientRelationships.clientId, userId),
          eq(ptClientRelationships.status, status),
          notAiTrainer,
        ),
      )
      .orderBy(desc(ptClientRelationships.createdAt));

    return rows.map((row) => ({
      id: row.relationshipId,
      trainer: {
        id: row.trainerId,
        fullName: row.trainerFullName ?? null,
        avatarUrl: row.trainerAvatarUrl ?? null,
      },
    }));
  }
}
