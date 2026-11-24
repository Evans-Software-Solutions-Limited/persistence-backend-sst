import {
  and,
  eq,
  ne,
  or,
  desc,
  inArray,
  count,
  isNull,
  sql,
} from "drizzle-orm";
import {
  workouts,
  workoutExercises,
  workoutExerciseSetTargets,
  exercises,
  friendships,
  workoutAssignments,
  userSubscriptions,
  subscriptionTiers,
  workoutSessions,
  sessionExercises,
  exerciseSets,
  profiles,
  savedGyms,
  type Workout,
} from "@persistence/db";
import { getDb, type Db } from "@persistence/db/client";
import { resolveWorkoutRepRange } from "../workouts/shared/repRange";
import {
  cloneSetTargets,
  deriveFromSetTargets,
  hasSetTargets,
  indexStoredSetTargets,
  preservedSetTargets,
  type SetTarget,
} from "../workouts/shared/setTargets";
import type { AdaptationCandidate } from "./exerciseRepository";
import {
  estimateWorkoutDurationMinutes,
  resolveEstimatedDurationMinutes,
} from "../workouts/estimateDuration";
import {
  classifySubscriptionStatus,
  resolveEffectiveScheduledTier,
  tierRowJoined,
} from "../entitlement/assertEntitlement";

export type WorkoutListType = "mine" | "assigned" | "default";

export interface ListWorkoutsFilters {
  type?: WorkoutListType;
  limit?: number;
  offset?: number;
  // When true (only meaningful with type="mine"), restrict to workouts the
  // author has flagged as owner-visible (show_in_owner_library = true). Sent by
  // the client only for trainers so a coach's personal My Workouts isn't
  // crowded by workouts authored for clients. Absent => unchanged behaviour.
  ownerLibraryOnly?: boolean;
  /** Include orphaned Loadout variations promoted by a deleted parent. */
  includeLoadoutVariations?: boolean;
}

export interface WorkoutExerciseRow {
  id: string;
  exerciseId: string;
  sortOrder: number;
  supersetGroup: number | null;
  targetSets: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
  // ─── Loadout provenance (spec-21 § 2.3, AC-3.3) ─────────────────────────
  // Null / false on every non-Loadout row, which is every row that predates the
  // feature. Projected here rather than only stored so a saved variation can
  // EXPLAIN itself — AC-3.3 requires the reason to survive into the variation,
  // and a write-only column satisfies the storage half but not the requirement.
  substitutedFromExerciseId: string | null;
  substitutionReason: unknown;
  isUserOverride: boolean;
  /**
   * PER-111: reps per set in set order, e.g. 10 / 8 / 8. OMITTED (not null,
   * not []) when the exercise has none, so 1.2.0 readers see exactly today's
   * shape. When present, targetSets / targetRepsMin / targetRepsMax hold the
   * derived count / lowest / highest reps.
   */
  setTargets?: SetTarget[];
  exercise: {
    id: string;
    name: string;
    category: string;
    difficultyLevel: string;
    videoUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
}

export interface WorkoutWithExercises extends Workout {
  exercises: WorkoutExerciseRow[];
}

export interface WorkoutQuota {
  used: number;
  limit: number | null;
}

/**
 * Last-resort workout cap when the `free` catalog row cannot be read.
 *
 * `subscription_tiers` is the source of truth and this duplicates it, which is
 * deliberate and narrow: it is used ONLY where the row is absent, i.e. a
 * catalog misconfiguration. `assertEntitlement` THROWS in that situation
 * (`requireFreeTierWorkoutLimit`), but `getQuota` used to resolve it to `null`
 * — and every reader treats a null limit as UNCAPPED. So a missing row made
 * the app show no limit while create 402s, and via `evaluateWorkoutTotalCapLock`
 * let a user finish a session that could never be saved: exactly the
 * display-vs-gate split `getQuota`'s docstring exists to prevent.
 *
 * Failing closed to the free allowance is the safe direction. The worst case
 * is a user with a genuinely higher limit briefly seeing this one; the
 * alternative offers creates the server will refuse.
 *
 * ⚠ Applies ONLY to a missing row. A real `free` row whose `workout_limit` is
 * explicitly NULL still means uncapped, because that is what the gate does —
 * see `resolveFreeTierLimit`.
 */
export const FREE_TIER_WORKOUT_LIMIT_FALLBACK = 3;

export interface ListWorkoutsResult {
  workouts: WorkoutWithExercises[];
  total: number;
  quota?: WorkoutQuota;
}

export interface CreateWorkoutExerciseInput {
  exerciseId: string;
  sortOrder: number;
  supersetGroup?: number | null;
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetDurationSeconds?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
  /**
   * PER-111. A non-empty list writes per-set rows and the derived old columns.
   * `null` = no per-set rows. `undefined` = not sent (an old bundle): on
   * update the design G preservation rule applies; on create, none.
   */
  setTargets?: SetTarget[] | null;
}

export interface CreateWorkoutInput {
  name: string;
  description?: string | null;
  visibility?: "private" | "friends" | "public";
  estimatedDurationMinutes?: number;
  // Owner-visibility (see schema.ts workouts.show_in_owner_library). Absent =>
  // defaults true (personal). The coach-authoring flow sends false.
  showInOwnerLibrary?: boolean;
  exercises?: CreateWorkoutExerciseInput[];
}

export interface UpdateWorkoutInput {
  name?: string;
  description?: string | null;
  visibility?: "private" | "friends" | "public";
  estimatedDurationMinutes?: number;
  showInOwnerLibrary?: boolean;
  exercises?: CreateWorkoutExerciseInput[];
}

// ─── Loadout variations (spec-21) ─────────────────────────────────────────

/**
 * One adapted version of a parent workout, as the parent's "Saved setups" list
 * needs it (AC-6.1): which gym, what kit, how many swaps, how old.
 */
export interface WorkoutVariationSummary {
  id: string;
  name: string;
  description: string | null;
  parentWorkoutId: string | null;
  variationKind: string | null;
  sourceGymId: string | null;
  /** Null once the saved gym is deleted — the kit snapshot survives (AC-7.3). */
  sourceGymName: string | null;
  sourceEquipmentTypeIds: string[] | null;
  /** Current saved-gym kit, null once the source gym is deleted. */
  currentSourceGymEquipmentTypeIds: string[] | null;
  /** Lets clients explain when the linked gym last changed. */
  currentSourceGymUpdatedAt: Date | null;
  estimatedDurationMinutes: number;
  /** Derived, never stored — see `listVariations`. */
  swapCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * One row of a parent plan, as the Loadout adaptation engine consumes it: the
 * targets that must be carried across unchanged (§ 1 rule 2) plus the source
 * exercise's ranking fields.
 */
export interface WorkoutAdaptationRow {
  workoutExerciseId: string;
  sortOrder: number;
  supersetGroup: number | null;
  targetSets: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
  /** PER-111: the parent's reps per set, carried into the preview. Omitted when none. */
  setTargets?: SetTarget[];
  source: AdaptationCandidate;
}

export interface CreateVariationExerciseInput extends CreateWorkoutExerciseInput {
  /** The exercise this row replaced; absent/null on a KEPT row. */
  substitutedFromExerciseId?: string | null;
  /**
   * Structured reason code `{ code, missingEquipment, matchedOn }` (design
   * § 7.2), stored as jsonb. Typed `unknown` here because the backend never
   * reads it back — the mobile layer renders copy from the code. Phase 1 owns
   * generating it server-side.
   */
  substitutionReason?: unknown;
  /** The user deliberately chose this row (AC-4.3). A quality signal only. */
  isUserOverride?: boolean;
}

export interface CreateVariationInput {
  name: string;
  description?: string | null;
  estimatedDurationMinutes?: number;
  /** Null for an ad-hoc equipment context (no saved gym involved). */
  sourceGymId?: string | null;
  /** Frozen snapshot of the kit this was adapted for (AC-5.2). */
  sourceEquipmentTypeIds: string[];
  exercises: CreateVariationExerciseInput[];
}

export type ReplaceVariationInput = CreateVariationInput;

export interface WorkoutHistory {
  // Number of times the calling user has COMPLETED this workout. 0 = never done.
  completedCount: number;
  // ISO timestamp of the most recent completed session, or null when never done.
  lastCompletedAt: string | null;
  // Mean session length across completed sessions, in seconds, or null.
  avgDurationSeconds: number | null;
  // The most recent completed session's headline stats, or null when never done.
  lastSession: {
    completedAt: string;
    totalVolumeKg: number;
    durationSeconds: number | null;
  } | null;
}

// Drizzle's transaction callback receives a typed PgTransaction; the public
// `Db` type captures the same query API surface so a helper can accept either
// the singleton or a transaction handle. Using a structural alias keeps the
// helper free of Drizzle's deep generic types.
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * PER-111: a workout exercise's reps per set as one JSON array in set order,
 * `[{"reps":10},{"reps":8},{"reps":8}]`, or NULL when it has none. A correlated
 * subquery (like `swapCount`) so every read stays ONE query and the per-set
 * rows can never be fetched without the exercise row that authorizes them.
 *
 * ⚠ Every column is table-QUALIFIED by hand. In a single-table select (no
 * join) Drizzle renders `${workoutExercises.id}` as a bare "id", which inside
 * this subquery resolves to workout_exercise_set_targets.id — the predicate
 * silently compares a row with itself and the update's preservation read
 * finds nothing. Caught by designG.setTargets.integration.test.ts.
 */
const st = sql.identifier("workout_exercise_set_targets");
const we = sql.identifier("workout_exercises");
const setTargetsJson = sql<SetTarget[] | null>`(
  select json_agg(json_build_object('reps', ${st}.${sql.identifier("target_reps")}) order by ${st}.${sql.identifier("set_number")})
  from ${workoutExerciseSetTargets}
  where ${st}.${sql.identifier("workout_exercise_id")} = ${we}.${sql.identifier("id")}
)`;

/** A row to insert plus the per-set targets to write under it (null = none). */
interface ExerciseInsert {
  values: ReturnType<WorkoutRepository["toWorkoutExerciseInsert"]> &
    Partial<ProvenanceFields>;
  setTargets: SetTarget[] | null;
}

/** The three Loadout provenance columns, as carried across an exercise replace. */
interface ProvenanceFields {
  substitutedFromExerciseId: string | null;
  substitutionReason: unknown;
  isUserOverride: boolean;
}

export class WorkoutRepository {
  static readonly key = "WorkoutRepository";

  // ─── Read ────────────────────────────────────────────────────────────

  async list(
    userId: string,
    filters: ListWorkoutsFilters,
  ): Promise<ListWorkoutsResult> {
    const db = getDb();
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    const type = filters.type ?? "mine";

    const whereClause = this.buildListWhereClause(
      type,
      userId,
      db,
      filters.ownerLibraryOnly ?? false,
      filters.includeLoadoutVariations ?? true,
    );

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(workouts)
        .where(whereClause)
        .orderBy(desc(workouts.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(workouts).where(whereClause),
    ]);

    const total = totalRows[0].value;

    const exercisesByWorkoutId = await this.fetchExercisesForWorkouts(
      db,
      rows.map((w) => w.id),
    );

    const result: WorkoutWithExercises[] = rows.map((w) => ({
      ...w,
      exercises: exercisesByWorkoutId.get(w.id) ?? [],
    }));

    const out: ListWorkoutsResult = { workouts: result, total };
    if (type === "mine") {
      out.quota = await this.getQuota(userId);
    }

    return out;
  }

  async getById(
    id: string,
    userId: string,
  ): Promise<WorkoutWithExercises | null> {
    const db = getDb();

    const [workout] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!workout) {
      return null;
    }

    const allowed = await this.canRead(db, workout, userId);
    if (!allowed) {
      return null;
    }

    return this.fetchWorkoutWithExercises(db, workout);
  }

  async getQuota(userId: string): Promise<WorkoutQuota> {
    const db = getDb();

    // The effective limit MUST mirror `assertEntitlement` (the create-workout
    // gate): read the LATEST subscription (by createdAt) LEFT-JOINed to its
    // tier, and revert an EXPIRED/CANCELLED sub to the free-tier limit. The
    // previous query filtered to payment_status IN ('active','pending') with no
    // revert clamp, so an expired premium returned limit=null (unlimited) — the
    // client then hid the "limit reached" upsell while the backend still
    // enforced 3 on create (the same client-tier-vs-server-entitlement skew as
    // the is-a-trainer flag). Kept in lockstep via the shared
    // `classifySubscriptionStatus`.
    const [usedRow, subRows] = await Promise.all([
      db
        .select({ value: count() })
        .from(workouts)
        .where(eq(workouts.createdBy, userId)),
      db
        .select({
          paymentStatus: userSubscriptions.paymentStatus,
          expiresAt: userSubscriptions.expiresAt,
          cancelledAt: userSubscriptions.cancelledAt,
          // Tells a period-end tier change apart from a genuine lapse — see
          // `classifySubscriptionStatus`'s `hasEffectiveScheduledChange`.
          metadata: userSubscriptions.metadata,
          // Catalog-row discriminator: null exactly when the LEFT JOIN found
          // no tier row. See `tierRowJoined` in assertEntitlement.ts — without
          // it, an off-catalog `tier_name`'s joined-null `workout_limit` reads
          // as "unlimited" and this endpoint reports no cap for a user the
          // create gate now (correctly) holds to the free allowance.
          catalogTierName: subscriptionTiers.tierName,
          workoutLimit: subscriptionTiers.workoutLimit,
        })
        .from(userSubscriptions)
        .leftJoin(
          subscriptionTiers,
          eq(userSubscriptions.tierName, subscriptionTiers.tierName),
        )
        .where(eq(userSubscriptions.userId, userId))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1),
    ]);

    const used = usedRow[0].value;
    const subRow = subRows[0] ?? null;

    // No sub row, a tier with no catalog row, or a cancelled/expired one
    // (classify returns a non-null deny reason) → the free-tier limit applies.
    // An active/trialing sub still inside its paid period — or a
    // cancelled-but-still-paid-through one (classify returns null) — keeps its
    // own tier limit.
    const reverted =
      subRow !== null &&
      // `tierRowJoined` rather than an inline `=== null`: the helper treats an
      // UNPROJECTED column as "not joined" on purpose, and re-deriving the
      // check here would fail open in exactly the way it exists to prevent.
      (!tierRowJoined(subRow) ||
        classifySubscriptionStatus(
          subRow.paymentStatus,
          subRow.expiresAt,
          subRow.cancelledAt,
          resolveEffectiveScheduledTier(subRow.metadata) !== null,
        ) !== null);

    const loadTierLimit = async (tierName: string) => {
      const rows = await db
        .select({ workoutLimit: subscriptionTiers.workoutLimit })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.tierName, tierName))
        .limit(1);
      return rows[0] ?? null;
    };

    /**
     * The free-tier limit, keeping the SAME two NULLs apart that the rest of
     * this file does — because the gate does.
     *
     *   - **Missing `free` ROW** → the fallback constant, never `null`.
     *     `assertEntitlement` throws here (`requireFreeTierWorkoutLimit`), so
     *     reporting "uncapped" made the app offer creates the server refuses.
     *     Both sides are degraded on a broken catalog; neither is permissive.
     *   - **Row present, `workout_limit` explicitly NULL** → `null`
     *     (uncapped), because that is what the gate does:
     *     `assertEntitlement` resolves free to `freeTier.workoutLimit ?? null`
     *     and allows on `null`, pinned by its own "treats free tier with
     *     workoutLimit=null as unlimited (catalog drift)" test, and
     *     `evaluateWorkoutTotalCapLock` names the case too.
     *
     * ⚠ An earlier cut of this collapsed the second case into the constant on
     * the reasoning that "free is never sold uncapped". True commercially, but
     * it opened the display-vs-gate split in the OPPOSITE direction — the app
     * showing "3 of 3" and locking create plus session-finish while the server
     * would have accepted every one. Parity with the gate is what matters
     * here, not what the price list says. If free-with-null should really be
     * capped, change `assertEntitlement` and this together.
     */
    const resolveFreeTierLimit = async (): Promise<number | null> => {
      const row = await loadTierLimit("free");
      if (row === null) return FREE_TIER_WORKOUT_LIMIT_FALLBACK;
      return row.workoutLimit ?? null;
    };

    let limit: number | null;
    if (subRow === null || reverted) {
      limit = await resolveFreeTierLimit();
    } else {
      limit = subRow.workoutLimit ?? null;

      // A period-end tier change that has already taken effect wins over the
      // row's own `tier_name`, which the renewal webhook has not rewritten
      // yet — and it is what suppressed the lapse in `classify…` above, so
      // NOT resolving its limit here leaves the outgoing tier's allowance in
      // place. This endpoint is the mobile "N of 3 workouts" display AND what
      // the client create gate reads, so a split from `assertEntitlement`
      // means the app offers a create the server then 402s — and, worse via
      // `evaluateWorkoutTotalCapLock`, lets a user finish a session that
      // cannot be saved. The docstring above requires this to mirror the gate.
      const scheduledTier = resolveEffectiveScheduledTier(subRow.metadata);
      if (scheduledTier !== null) {
        // ⚠ Row-missing vs limit-NULL, the same two NULLs `tierRowJoined`
        // separates: an absent scheduled tier falls back to free, an
        // explicitly-uncapped one stays uncapped.
        const scheduled = await loadTierLimit(scheduledTier);
        limit =
          scheduled === null
            ? await resolveFreeTierLimit()
            : (scheduled.workoutLimit ?? null);
      }
    }

    return { used, limit };
  }

  /**
   * Per-workout completed-session history for the CALLING user, feeding the
   * detail hero's market-standard stats block. Access is gated by `canRead`
   * (same as the detail GET); a null return maps to 404 at the handler. Every
   * aggregate is scoped to `user_id = me` — a client viewing an assigned
   * coach workout sees only their OWN completed sessions of it, never anyone
   * else's. Returns the empty state (count 0, null aggregates) when never done.
   */
  async getHistory(id: string, userId: string): Promise<WorkoutHistory | null> {
    const db = getDb();

    const [workout] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!workout) return null;
    if (!(await this.canRead(db, workout, userId))) return null;

    const completedFilter = and(
      eq(workoutSessions.userId, userId),
      eq(workoutSessions.workoutId, id),
      eq(workoutSessions.status, "completed"),
    );

    const [aggRows, lastRows] = await Promise.all([
      db
        .select({
          completedCount: sql<number>`count(*)::int`,
          avgDurationSeconds: sql<
            number | null
          >`avg(${workoutSessions.totalDurationSeconds})`,
        })
        .from(workoutSessions)
        .where(completedFilter),
      db
        .select({
          id: workoutSessions.id,
          completedAt: workoutSessions.completedAt,
          createdAt: workoutSessions.createdAt,
          totalDurationSeconds: workoutSessions.totalDurationSeconds,
        })
        .from(workoutSessions)
        .where(completedFilter)
        // COALESCE(completedAt, createdAt) mirrors sessionRepository so a
        // completed row with a null completedAt still orders sanely. `id` is a
        // deterministic secondary key so two sessions sharing a timestamp
        // resolve the same way every call (IB 🔵).
        .orderBy(
          desc(
            sql`COALESCE(${workoutSessions.completedAt}, ${workoutSessions.createdAt})`,
          ),
          desc(workoutSessions.id),
        )
        .limit(1),
    ]);

    const completedCount = Number(aggRows[0]?.completedCount ?? 0);
    const avgDurationSecondsRaw = aggRows[0]?.avgDurationSeconds;
    const avgDurationSeconds =
      avgDurationSecondsRaw == null ? null : Number(avgDurationSecondsRaw);

    const last = lastRows[0];
    if (!last) {
      return {
        completedCount,
        lastCompletedAt: null,
        avgDurationSeconds,
        lastSession: null,
      };
    }

    const [volumeRow] = await db
      .select({
        volume: sql<number>`COALESCE(SUM(${exerciseSets.weightKg} * ${exerciseSets.reps}), 0)::float`,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .where(
        and(
          eq(sessionExercises.sessionId, last.id),
          eq(exerciseSets.isCompleted, true),
        ),
      );

    const lastCompletedAt = (last.completedAt ?? last.createdAt) as Date | null;
    const lastCompletedISO = lastCompletedAt
      ? lastCompletedAt.toISOString()
      : null;

    return {
      completedCount,
      lastCompletedAt: lastCompletedISO,
      avgDurationSeconds,
      lastSession: {
        // A completed session always resolves a date via the COALESCE above.
        completedAt: lastCompletedISO ?? new Date(0).toISOString(),
        totalVolumeKg: Number(volumeRow?.volume ?? 0),
        durationSeconds: last.totalDurationSeconds ?? null,
      },
    };
  }

  // ─── Write ───────────────────────────────────────────────────────────

  /**
   * Create a workout and its exercise rows in one transaction.
   *
   * `clientRequestId` makes the create REPLAY-SAFE — see the twin on
   * `ExerciseRepository.create` for the reasoning. Critically, the idempotency
   * check is INSIDE the transaction: a replay must not insert a second set of
   * `workout_exercises` rows against the first attempt's workout either, which is
   * why the short-circuit returns before the child insert.
   */
  /**
   * Resolve a create that has ALREADY been committed under this idempotency key,
   * or null if there is none.
   *
   * Exists so the handler can recognise a replay BEFORE it runs any gate whose
   * answer would differ on the second attempt. The entitlement check is exactly
   * such a gate: the first attempt's insert advances the workout-count trigger, so
   * a user who was one workout below their limit is AT the limit by the time the
   * replay arrives, and `assertEntitlement` denies it with a 402. The mobile drain
   * turns that into `blocked_entitlement`, the user is shown an upgrade paywall for
   * a workout that already exists, and — because the queue entry never reaches
   * `completed` — `unsyncedWorkoutsIn` keeps preserving the optimistic `local-…` row
   * alongside the committed server row on every refresh, so the workout is listed
   * twice and the local copy 400s when opened.
   *
   * The key's whole promise is that "a replay is indistinguishable from the original
   * success" (see 20260727120100_client_request_id_idempotency.sql). A gate in front
   * of the short-circuit breaks that promise.
   */
  async findByClientRequestId(
    userId: string,
    clientRequestId: string,
  ): Promise<WorkoutWithExercises | null> {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(workouts)
      .where(
        and(
          eq(workouts.createdBy, userId),
          eq(workouts.clientRequestId, clientRequestId),
        ),
      )
      .limit(1);
    if (!existing) return null;
    return this.fetchWorkoutWithExercises(db, existing);
  }

  async createWithExercises(
    userId: string,
    input: CreateWorkoutInput,
    clientRequestId?: string | null,
  ): Promise<WorkoutWithExercises> {
    const db = getDb();
    const key = clientRequestId ?? null;
    // Per-set targets fix the old columns to their derived values BEFORE
    // anything (the duration estimate included) reads them.
    const planned = input.exercises?.map((ex) => this.withDerivedTargets(ex));

    return db.transaction(async (tx) => {
      const values = {
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? "private",
        // Derived from the plan when the caller doesn't state one — see
        // estimateDuration.ts. The old `?? 30` stored every workout as 30 min.
        estimatedDurationMinutes: resolveEstimatedDurationMinutes(
          input.estimatedDurationMinutes,
          planned,
        ),
        // Absent => true (personal). Coach-authoring flow sends false.
        showInOwnerLibrary: input.showInOwnerLibrary ?? true,
        createdBy: userId,
        ...(key !== null ? { clientRequestId: key } : {}),
      };

      let workout: typeof workouts.$inferSelect | undefined;
      if (key === null) {
        [workout] = await tx.insert(workouts).values(values).returning();
      } else {
        const inserted = await tx
          .insert(workouts)
          .values(values)
          .onConflictDoNothing({
            target: [workouts.createdBy, workouts.clientRequestId],
          })
          .returning();
        if (inserted[0]) {
          workout = inserted[0];
        } else {
          // Replay: the first attempt already committed this workout AND its
          // exercise rows. Return it as-is — re-inserting children here is the
          // duplicate this whole mechanism exists to prevent.
          const existing = await tx
            .select()
            .from(workouts)
            .where(
              and(
                eq(workouts.createdBy, userId),
                eq(workouts.clientRequestId, key),
              ),
            )
            .limit(1);
          if (existing[0]) {
            return this.fetchWorkoutWithExercises(tx, existing[0]);
          }
          // Should be unreachable while the index is scoped to created_by; fall
          // back to a keyless insert rather than returning undefined.
          [workout] = await tx
            .insert(workouts)
            .values({ ...values, clientRequestId: null })
            .returning();
        }
      }

      if (planned && planned.length > 0) {
        await this.insertExercises(
          tx,
          planned.map((ex) => ({
            values: this.toWorkoutExerciseInsert(workout!.id, ex),
            setTargets: hasSetTargets(ex.setTargets)
              ? cloneSetTargets(ex.setTargets)
              : null,
          })),
        );
      }

      return this.fetchWorkoutWithExercises(tx, workout!);
    });
  }

  async update(
    id: string,
    userId: string,
    data: UpdateWorkoutInput,
  ): Promise<WorkoutWithExercises | null> {
    const db = getDb();
    const planned = data.exercises?.map((ex) => this.withDerivedTargets(ex));

    return db.transaction(async (tx) => {
      const metadata: Partial<Workout> = {};
      if (data.name !== undefined) metadata.name = data.name;
      if (data.description !== undefined)
        metadata.description = data.description;
      if (data.visibility !== undefined) metadata.visibility = data.visibility;
      if (data.estimatedDurationMinutes !== undefined)
        metadata.estimatedDurationMinutes = data.estimatedDurationMinutes;
      // Editing the PLAN re-derives the estimate, so a workout that grows from
      // 3 exercises to 7 stops claiming its original duration. An explicit
      // duration in the same PATCH still wins (the branch above). An edit that
      // doesn't touch `exercises` leaves the stored value alone.
      //
      // `length > 0` mirrors legacy `updateWorkout` (workoutMutations.ts:357):
      // a PATCH that empties the plan wipes the junction rows but must NOT
      // rewrite the duration to 0 — there is nothing left to estimate from, so
      // the last meaningful value is better than a fabricated zero.
      else if (planned !== undefined && planned.length > 0)
        metadata.estimatedDurationMinutes =
          estimateWorkoutDurationMinutes(planned);
      // Present-only: a partial PATCH that omits the flag leaves it untouched.
      if (data.showInOwnerLibrary !== undefined)
        metadata.showInOwnerLibrary = data.showInOwnerLibrary;

      // Ownership check folded into the UPDATE WHERE — no separate SELECT,
      // no TOCTOU window. Empty `returning()` means either the row doesn't
      // exist or the caller doesn't own it; both surface as 404 at the
      // handler layer.
      const [updated] = await tx
        .update(workouts)
        .set({ ...metadata, updatedAt: new Date() })
        .where(and(eq(workouts.id, id), eq(workouts.createdBy, userId)))
        .returning();

      if (!updated) return null;

      if (planned !== undefined) {
        // Loadout (spec-21 AC-3.3): capture swap provenance BEFORE the wipe.
        //
        // This is a full delete-and-reinsert, and `toWorkoutExerciseInsert`
        // projects only the ten pre-Loadout fields — so without this, ANY edit
        // through the generic workout editor (bumping one exercise's target sets
        // on a saved variation, say) would silently reset every row's
        // `substituted_from_exercise_id` / `substitution_reason` /
        // `is_user_override` to their defaults. `listVariations`' derived
        // swapCount would drop to 0 and the "why was this swapped" data would be
        // gone for good — a permanent, invisible data loss on a normal edit.
        //
        // Matched on `exercise_id`, queued so a workout that legitimately
        // contains the same exercise twice keeps both rows' provenance in order.
        // A row whose exercise CHANGED gets no provenance, which is correct: it
        // is a different exercise now, so the old reason no longer describes it.
        //
        // PER-111: the same read captures the stored reps per set, because
        // the wipe below cascades them away. An exercise sent WITHOUT
        // `setTargets` (a 1.2.0 bundle) keeps them under design G's rule —
        // see `preservedSetTargets`.
        const { provenanceByExercise, storedSetTargets } =
          await this.captureProvenance(tx, id);

        // Full-replacement: wipe junction rows + insert new array.
        await tx
          .delete(workoutExercises)
          .where(eq(workoutExercises.workoutId, id));

        if (planned.length > 0) {
          await this.insertExercises(
            tx,
            planned.map((ex) => {
              const values = this.toWorkoutExerciseInsert(id, ex);
              return {
                values: {
                  ...values,
                  ...(provenanceByExercise.get(ex.exerciseId)?.shift() ?? {}),
                },
                setTargets: this.resolveSetTargets(
                  ex,
                  values,
                  storedSetTargets,
                ),
              };
            }),
          );
        }
      }

      return this.fetchWorkoutWithExercises(tx, updated);
    });
  }

  // ─── Loadout variations (spec-21 § 2.2 / § 3) ────────────────────────

  /**
   * The workout row IF the caller may READ it, else null. Own / public /
   * friends / assigned — the same grant set `getById` applies, but without the
   * exercise fetch, so the variation endpoints can gate on the PARENT cheaply.
   *
   * `null` covers both "doesn't exist" and "not allowed", which the handlers
   * surface as one 404 — no 403/404 distinction, so a caller cannot probe for
   * the existence of workouts they can't see.
   *
   * Read, not own (AC-1.2): Loadout applies to a coach-assigned workout or a
   * public template, not just the caller's own.
   *
   * Returns the ROW rather than a boolean because the create path also needs
   * `parentWorkoutId` off it (to refuse a variation of a variation) — one read,
   * two decisions.
   */
  async findReadableWorkout(
    id: string,
    userId: string,
  ): Promise<Workout | null> {
    const db = getDb();
    const [workout] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);
    if (!workout) return null;
    return (await this.canRead(db, workout, userId)) ? workout : null;
  }

  /**
   * The exercise ids a workout's rows point at. Used by the create-variation
   * path to exempt rows CARRIED OVER from the parent from the catalogue
   * read-visibility check (see `findUnreadableExerciseIds`' call site).
   *
   * Why the exemption is safe: the caller has already passed `findReadableWorkout` on
   * the parent, and `fetchExercisesForWorkouts` embeds exercise fields WITHOUT
   * the catalogue visibility predicate — so these exercises are already visible
   * to this caller on the workout-detail screen. Exempting them grants no read
   * the caller did not already have; withholding the exemption would reject
   * exactly the case AC-1.2 mandates (adapting a public template or a
   * friend's workout that uses the owner's custom exercises).
   */
  async listExerciseIdsForWorkout(workoutId: string): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ exerciseId: workoutExercises.exerciseId })
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId));
    return rows.map((r) => r.exerciseId);
  }

  /**
   * The parent plan as the adaptation engine needs it (spec-21 § 7 step 1/3):
   * every row's targets, plus the RANKING fields of the exercise it points at
   * (muscles, equipment, difficulty, movement type). In `sort_order` order.
   *
   * `fetchExercisesForWorkouts` cannot serve this — its embedded exercise block
   * is the wire shape (name / category / difficulty / media) and carries none of
   * the ranking signals. Duplicating the join here rather than widening that
   * projection keeps ~400-row-per-adaptation columns off every workout read.
   *
   * NO catalogue visibility predicate, matching `fetchExercisesForWorkouts`
   * (documented as intentional in `exerciseRepository.ts`): the caller has
   * already passed `findReadableWorkout` on this workout, so these rows are
   * exactly what they are looking at on screen. Applying the predicate would
   * make an adaptation of a public template fail on the author's own custom
   * exercises — the case AC-1.2 mandates.
   *
   * `innerJoin`, not `leftJoin`: `workout_exercises.exercise_id` is NOT NULL with
   * an FK, so a row can't lose its exercise. A `leftJoin` here would introduce a
   * nullable source the ranker would have to carry a dead branch for.
   */
  async listAdaptationRows(workoutId: string): Promise<WorkoutAdaptationRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        workoutExerciseId: workoutExercises.id,
        sortOrder: workoutExercises.sortOrder,
        supersetGroup: workoutExercises.supersetGroup,
        targetSets: workoutExercises.targetSets,
        targetRepsMin: workoutExercises.targetRepsMin,
        targetRepsMax: workoutExercises.targetRepsMax,
        targetDurationSeconds: workoutExercises.targetDurationSeconds,
        restSeconds: workoutExercises.restSeconds,
        notes: workoutExercises.notes,
        setTargets: setTargetsJson,
        exerciseId: exercises.id,
        name: exercises.name,
        category: exercises.category,
        difficultyLevel: exercises.difficultyLevel,
        movementType: exercises.movementType,
        primaryMuscles: exercises.primaryMuscles,
        secondaryMuscles: exercises.secondaryMuscles,
        equipmentRequired: exercises.equipmentRequired,
        thumbnailUrl: exercises.thumbnailUrl,
      })
      .from(workoutExercises)
      .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(workoutExercises.sortOrder);

    return rows.map((row) => ({
      workoutExerciseId: row.workoutExerciseId,
      sortOrder: row.sortOrder,
      supersetGroup: row.supersetGroup,
      targetSets: row.targetSets,
      targetRepsMin: row.targetRepsMin,
      targetRepsMax: row.targetRepsMax,
      targetDurationSeconds: row.targetDurationSeconds,
      restSeconds: row.restSeconds,
      notes: row.notes,
      ...(hasSetTargets(row.setTargets)
        ? { setTargets: cloneSetTargets(row.setTargets) }
        : {}),
      source: {
        id: row.exerciseId,
        name: row.name,
        category: row.category,
        difficultyLevel: row.difficultyLevel,
        movementType: row.movementType,
        // Nullable on rows predating the `.default([])`; normalised so every
        // ranking signal sees an empty set rather than a silent null.
        primaryMuscles: row.primaryMuscles ?? [],
        secondaryMuscles: row.secondaryMuscles ?? [],
        equipmentRequired: row.equipmentRequired ?? [],
        thumbnailUrl: row.thumbnailUrl,
      },
    }));
  }

  /**
   * The CALLER's variations of `parentId`, newest first (AC-6.1 / AC-6.2).
   *
   * Scoped by `created_by = userId` as well as `parent_workout_id`: a variation
   * is owned by whoever ran the adaptation, so two athletes adapting the same
   * coach-assigned parent must never see each other's setups. That ownership
   * filter is the data-isolation control here, not a convenience.
   *
   * `swapCount` is a correlated subquery rather than a stored column, so it can
   * never drift from the rows it counts (design § 2.3). Written as a subquery
   * rather than a GROUP BY aggregate deliberately — a parameterised expression
   * reused across SELECT and GROUP BY lands in different bind slots and throws
   * Postgres 42803 (see memory/reference_drizzle_groupby_param_bug).
   *
   * `sourceGymName` is LEFT JOINed and is null once the gym is deleted; the
   * frozen `sourceEquipmentTypeIds` snapshot still describes the kit (AC-7.3).
   */
  async listVariations(
    parentId: string,
    userId: string,
  ): Promise<WorkoutVariationSummary[]> {
    const db = getDb();
    return db
      .select({
        id: workouts.id,
        name: workouts.name,
        description: workouts.description,
        parentWorkoutId: workouts.parentWorkoutId,
        variationKind: workouts.variationKind,
        sourceGymId: workouts.sourceGymId,
        sourceGymName: savedGyms.name,
        sourceEquipmentTypeIds: workouts.sourceEquipmentTypeIds,
        currentSourceGymEquipmentTypeIds: savedGyms.equipmentTypeIds,
        currentSourceGymUpdatedAt: savedGyms.updatedAt,
        estimatedDurationMinutes: workouts.estimatedDurationMinutes,
        swapCount: sql<number>`(
          select count(*) from ${workoutExercises}
          where ${workoutExercises.workoutId} = ${workouts.id}
            and ${workoutExercises.substitutedFromExerciseId} is not null
        )`.mapWith(Number),
        createdAt: workouts.createdAt,
        updatedAt: workouts.updatedAt,
      })
      .from(workouts)
      .leftJoin(savedGyms, eq(workouts.sourceGymId, savedGyms.id))
      .where(
        and(
          eq(workouts.parentWorkoutId, parentId),
          eq(workouts.createdBy, userId),
        ),
      )
      .orderBy(desc(workouts.createdAt));
  }

  /**
   * Persist a reviewed adaptation as a variation under `parentId`, in ONE
   * transaction (AC-5.1). The parent's own row and `workout_exercises` are never
   * touched — a variation is additive by construction, not by discipline
   * (AC-1.3).
   *
   * ⚠ `visibility` is hardcoded `'private'` and must stay that way. It does NOT
   * inherit the parent's. `buildListWhereClause`'s `default` branch is
   * `visibility = 'public' AND (created_by IS NULL OR created_by != userId)`, so
   * a variation of a PUBLIC parent that inherited `public` would land in every
   * other user's browse — carrying this user's gym kit with it (design § 2.2).
   *
   * `showInOwnerLibrary` is left at its default `true` on purpose: the variation
   * is hidden from the library by the `parent_workout_id IS NULL` predicate, so
   * when a parent is deleted (FK `SET NULL`) the row is promoted back into the
   * owner's library rather than being invisible forever.
   */
  async createVariation(
    userId: string,
    parentId: string,
    input: CreateVariationInput,
  ): Promise<WorkoutWithExercises> {
    const db = getDb();
    const planned = input.exercises.map((ex) => this.withDerivedTargets(ex));

    return db.transaction(async (tx) => {
      const [variation] = await tx
        .insert(workouts)
        .values({
          name: input.name,
          description: input.description ?? null,
          // NEVER inherited from the parent — see the doc comment above.
          visibility: "private",
          estimatedDurationMinutes: resolveEstimatedDurationMinutes(
            input.estimatedDurationMinutes,
            planned,
          ),
          createdBy: userId,
          parentWorkoutId: parentId,
          variationKind: "loadout",
          sourceGymId: input.sourceGymId ?? null,
          sourceEquipmentTypeIds: input.sourceEquipmentTypeIds,
        })
        .returning();

      if (planned.length > 0) {
        await this.insertExercises(
          tx,
          await this.variationRows(tx, parentId, variation.id, planned),
        );
      }

      return this.fetchWorkoutWithExercises(tx, variation);
    });
  }

  /**
   * Replace an owned Loadout variation in place after a fresh review.
   *
   * The ownership, root-parent relationship and variation kind are folded into
   * the UPDATE predicate. That makes a foreign, detached or non-Loadout workout
   * indistinguishable from a missing variation and closes the TOCTOU window
   * between validation and mutation. The workout id is never replaced, so
   * sessions/history that reference it remain attached.
   */
  async replaceVariation(
    userId: string,
    parentId: string,
    variationId: string,
    input: ReplaceVariationInput,
  ): Promise<WorkoutVariationSummary | null> {
    const db = getDb();
    const planned = input.exercises.map((ex) => this.withDerivedTargets(ex));

    return db.transaction(async (tx) => {
      const [variation] = await tx
        .update(workouts)
        .set({
          name: input.name,
          description: input.description ?? null,
          visibility: "private",
          estimatedDurationMinutes: resolveEstimatedDurationMinutes(
            input.estimatedDurationMinutes,
            planned,
          ),
          sourceGymId: input.sourceGymId ?? null,
          sourceEquipmentTypeIds: input.sourceEquipmentTypeIds,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workouts.id, variationId),
            eq(workouts.createdBy, userId),
            eq(workouts.parentWorkoutId, parentId),
            eq(workouts.variationKind, "loadout"),
          ),
        )
        .returning();

      if (!variation) return null;

      await tx
        .delete(workoutExercises)
        .where(eq(workoutExercises.workoutId, variationId));

      if (planned.length > 0) {
        await this.insertExercises(
          tx,
          await this.variationRows(tx, parentId, variationId, planned),
        );
      }

      const [summary] = await tx
        .select({
          id: workouts.id,
          name: workouts.name,
          description: workouts.description,
          parentWorkoutId: workouts.parentWorkoutId,
          variationKind: workouts.variationKind,
          sourceGymId: workouts.sourceGymId,
          sourceGymName: savedGyms.name,
          sourceEquipmentTypeIds: workouts.sourceEquipmentTypeIds,
          currentSourceGymEquipmentTypeIds: savedGyms.equipmentTypeIds,
          currentSourceGymUpdatedAt: savedGyms.updatedAt,
          estimatedDurationMinutes: workouts.estimatedDurationMinutes,
          swapCount: sql<number>`(
            select count(*) from ${workoutExercises}
            where ${workoutExercises.workoutId} = ${workouts.id}
              and ${workoutExercises.substitutedFromExerciseId} is not null
          )`.mapWith(Number),
          createdAt: workouts.createdAt,
          updatedAt: workouts.updatedAt,
        })
        .from(workouts)
        .leftJoin(savedGyms, eq(workouts.sourceGymId, savedGyms.id))
        .where(eq(workouts.id, variationId))
        .limit(1);

      return summary ?? null;
    });
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Same as `update`: ownership check folded into the DELETE WHERE so a
    // concurrent delete can't surface as 500. FK cascade on
    // `workout_exercises.workoutId` cleans up junction rows; sessions get
    // `workoutId = NULL` via FK `set null`.
    const result = await db
      .delete(workouts)
      .where(and(eq(workouts.id, id), eq(workouts.createdBy, userId)))
      .returning();

    return result.length > 0;
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private buildListWhereClause(
    type: WorkoutListType,
    userId: string,
    db: Db,
    ownerLibraryOnly: boolean,
    includeLoadoutVariations: boolean,
  ) {
    const loadoutVisibility = includeLoadoutVariations
      ? undefined
      : or(
          isNull(workouts.variationKind),
          ne(workouts.variationKind, "loadout"),
        );

    if (type === "mine") {
      // `ownerLibraryOnly` de-crowds a trainer's personal My Workouts: only
      // workouts they authored AND flagged owner-visible. The client sends it
      // for trainers only; regular athletes never set it, so `mine` stays
      // "everything I created" for them (unchanged). Only meaningful for
      // type="mine" — assigned/default ignore it.
      //
      // Loadout (spec-21 § 4, AC-6.4): `parent_workout_id IS NULL` excludes
      // variations from the top-level library — they belong under their parent
      // ("Saved setups"), so a user with one workout and four adapted versions
      // of it sees ONE card, not five.
      //
      // ⚠ It must be on BOTH branches. Patching only the second would leave
      // trainers — the callers who pass `ownerLibraryOnly: true` — still seeing
      // every variation, which is the exact crowding this de-crowds.
      //
      // Deliberately NOT implemented as `show_in_owner_library = false` on
      // variations: that column has a specific documented meaning
      // (coach-authoring de-crowding, migration 20260712120000), and overloading
      // it would ALSO leave orphaned variations invisible forever after a parent
      // delete. `parent IS NULL` composes correctly with the FK's
      // `ON DELETE SET NULL` — a deleted parent promotes its variations back
      // into the library instead of hiding them (AC-5.4).
      return ownerLibraryOnly
        ? and(
            eq(workouts.createdBy, userId),
            eq(workouts.showInOwnerLibrary, true),
            isNull(workouts.parentWorkoutId),
            loadoutVisibility,
          )
        : and(
            eq(workouts.createdBy, userId),
            isNull(workouts.parentWorkoutId),
            loadoutVisibility,
          );
    }
    if (type === "assigned") {
      // `show_in_library` is the coach's per-assignment "clutter the
      // client's library?" flag (specs/19-programs D3) — plan-only
      // assignments are excluded here but still surface on Home. The
      // IN-subquery dedupes repeated occurrences of the same workout.
      const assignedIds = db
        .select({ workoutId: workoutAssignments.workoutId })
        .from(workoutAssignments)
        .where(
          and(
            eq(workoutAssignments.clientId, userId),
            eq(workoutAssignments.showInLibrary, true),
          ),
        );
      return and(inArray(workouts.id, assignedIds), loadoutVisibility);
    }
    // default — public, but exclude user's own publics (those show under
    // "mine"). Uses `isNull OR ne` because in SQL `NULL != value`
    // evaluates to NULL (falsy), which would silently exclude system-
    // seeded / community workouts where `createdBy` is NULL. Spec:
    // 04-workout-management/design.md § API Contract > GET /workouts >
    // Filter semantics — "createdBy IS NULL OR createdBy != userId".
    return and(
      eq(workouts.visibility, "public"),
      or(isNull(workouts.createdBy), ne(workouts.createdBy, userId)),
      loadoutVisibility,
      // Cluster 2a — hide a soft-deleted author's public workouts from
      // everyone else's browse/list immediately. `createdBy IS NULL`
      // (system-seeded) trivially satisfies NOT EXISTS, so this only
      // excludes rows with a real, currently-soft-deleted owner.
      sql`not exists (select 1 from ${profiles} where ${profiles.id} = ${workouts.createdBy} and ${profiles.deletedAt} is not null)`,
    );
  }

  /**
   * Cluster 2a — is `ownerId`'s profile currently soft-deleted? `null`
   * ownerId (system-seeded / community content with no author) is never
   * "deleted" — there's no profile to check.
   */
  private async isOwnerSoftDeleted(
    db: DbOrTx,
    ownerId: string | null,
  ): Promise<boolean> {
    if (ownerId === null) return false;
    const rows = await db
      .select({ deletedAt: profiles.deletedAt })
      .from(profiles)
      .where(eq(profiles.id, ownerId))
      .limit(1);
    return rows[0]?.deletedAt != null;
  }

  private async canRead(
    db: DbOrTx,
    workout: Workout,
    userId: string,
  ): Promise<boolean> {
    if (workout.createdBy === userId) return true;

    // Cluster 2a — a soft-deleted author's public/friends workout stops
    // being grantable through THOSE visibility paths immediately (Brad's
    // "hide from coach immediately" call extends to any cross-user
    // visibility surface). Deliberately falls through to the assignment
    // grant below rather than returning false outright — a client who
    // already has this workout assigned (e.g. by a coach who has since
    // deleted their account) keeps access to what was already assigned;
    // only the general public/friends-browse grant is revoked. Only checked
    // for public/friends — a private workout's only possible grant is the
    // assignment below regardless of the owner's deletion status, so this
    // extra round-trip is skipped for the (dominant, coach-assigns-private-
    // workout) private-visibility case.
    const ownerDeleted =
      workout.visibility === "public" || workout.visibility === "friends"
        ? await this.isOwnerSoftDeleted(db, workout.createdBy)
        : false;

    if (!ownerDeleted && workout.visibility === "public") return true;
    if (!ownerDeleted && workout.visibility === "friends") {
      const ownerId = workout.createdBy!;
      const friendship = await db
        .select({ id: friendships.id })
        .from(friendships)
        .where(
          and(
            or(
              and(
                eq(friendships.userId, ownerId),
                eq(friendships.friendId, userId),
              ),
              and(
                eq(friendships.userId, userId),
                eq(friendships.friendId, ownerId),
              ),
            ),
            eq(friendships.status, "accepted"),
          ),
        )
        .limit(1);
      if (friendship.length > 0) return true;
      // fall through — an assignment can still grant access.
    }
    // Assignment grant (specs/19-programs AC 5.5): a coach can assign
    // their own PRIVATE (or friends-only) workout — the assignment row
    // itself is the read permission, otherwise the client could list the
    // workout via type=assigned but 404 on its detail. Checked last so the
    // owner / public / friend fast paths stay exactly as they were.
    const assignment = await db
      .select({ id: workoutAssignments.id })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.workoutId, workout.id),
          eq(workoutAssignments.clientId, userId),
        ),
      )
      .limit(1);
    return assignment.length > 0;
  }

  private async fetchWorkoutWithExercises(
    db: DbOrTx,
    workout: Workout,
  ): Promise<WorkoutWithExercises> {
    // Routes through the batch helper so the select clause + join shape
    // live in exactly one place. Avoids drift between single-workout
    // and list responses if a column is added or renamed later.
    const grouped = await this.fetchExercisesForWorkouts(db, [workout.id]);
    return { ...workout, exercises: grouped.get(workout.id) ?? [] };
  }

  private async fetchExercisesForWorkouts(
    db: DbOrTx,
    workoutIds: string[],
  ): Promise<Map<string, WorkoutExerciseRow[]>> {
    const grouped = new Map<string, WorkoutExerciseRow[]>();
    if (workoutIds.length === 0) return grouped;

    const rows = await db
      .select({
        workoutId: workoutExercises.workoutId,
        id: workoutExercises.id,
        exerciseId: workoutExercises.exerciseId,
        sortOrder: workoutExercises.sortOrder,
        supersetGroup: workoutExercises.supersetGroup,
        targetSets: workoutExercises.targetSets,
        targetRepsMin: workoutExercises.targetRepsMin,
        targetRepsMax: workoutExercises.targetRepsMax,
        targetDurationSeconds: workoutExercises.targetDurationSeconds,
        restSeconds: workoutExercises.restSeconds,
        notes: workoutExercises.notes,
        // Loadout provenance (spec-21 AC-3.3). This is the ONE projection behind
        // GET /workouts/:id, the list response and createVariation's own 201
        // body, so omitting these would make the reason write-only.
        substitutedFromExerciseId: workoutExercises.substitutedFromExerciseId,
        substitutionReason: workoutExercises.substitutionReason,
        isUserOverride: workoutExercises.isUserOverride,
        // PER-111 — see `setTargetsJson`.
        setTargets: setTargetsJson,
        exercise: {
          id: exercises.id,
          name: exercises.name,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: exercises.category as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          difficultyLevel: exercises.difficultyLevel as any,
          videoUrl: exercises.videoUrl,
          thumbnailUrl: exercises.thumbnailUrl,
        },
      })
      .from(workoutExercises)
      .leftJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
      .where(inArray(workoutExercises.workoutId, workoutIds))
      .orderBy(workoutExercises.workoutId, workoutExercises.sortOrder);

    for (const row of rows) {
      const { workoutId, setTargets, ...rest } = row;
      const list = grouped.get(workoutId) ?? [];
      // Omitted, not null, when there are none: 1.2.0 sees today's shape.
      list.push(
        hasSetTargets(setTargets)
          ? { ...rest, setTargets: cloneSetTargets(setTargets) }
          : rest,
      );
      grouped.set(workoutId, list);
    }

    return grouped;
  }

  /**
   * Existing Loadout provenance for a workout's rows, grouped by `exercise_id`
   * and kept in `sort_order` so a repeated exercise's entries are consumed in
   * the order they appeared. Feeds `update`'s delete-and-reinsert.
   *
   * Returns an EMPTY map for an ordinary workout — every row that predates
   * Loadout has null provenance, so the spread is a no-op and the pre-existing
   * update behaviour is unchanged.
   */
  private async captureProvenance(
    db: DbOrTx,
    workoutId: string,
  ): Promise<{
    provenanceByExercise: Map<string, ProvenanceFields[]>;
    storedSetTargets: Map<string, SetTarget[][]>;
  }> {
    const rows = await db
      .select({
        exerciseId: workoutExercises.exerciseId,
        sortOrder: workoutExercises.sortOrder,
        substitutedFromExerciseId: workoutExercises.substitutedFromExerciseId,
        substitutionReason: workoutExercises.substitutionReason,
        isUserOverride: workoutExercises.isUserOverride,
        setTargets: setTargetsJson,
      })
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(workoutExercises.sortOrder);

    const storedSetTargets = indexStoredSetTargets(
      rows.map((row) => ({
        exerciseId: row.exerciseId,
        sortOrder: row.sortOrder,
        setTargets: row.setTargets ?? [],
      })),
    );

    const grouped = new Map<string, ProvenanceFields[]>();
    for (const row of rows) {
      // Nothing to carry for a row that was never a swap and never overridden.
      if (row.substitutedFromExerciseId === null && !row.isUserOverride) {
        continue;
      }
      const list = grouped.get(row.exerciseId) ?? [];
      list.push({
        substitutedFromExerciseId: row.substitutedFromExerciseId,
        substitutionReason: row.substitutionReason,
        isUserOverride: row.isUserOverride,
      });
      grouped.set(row.exerciseId, list);
    }
    return { provenanceByExercise: grouped, storedSetTargets };
  }

  // ─── Reps per set (PER-111, design G part 1) ─────────────────────────

  /**
   * The input with its old columns replaced by the values derived from its
   * per-set targets, when it has any. So the stored `target_sets` /
   * `target_reps_min` / `target_reps_max` (and the duration estimate) always
   * agree with the per-set rows, whatever the client sent alongside them.
   */
  private withDerivedTargets<T extends CreateWorkoutExerciseInput>(ex: T): T {
    return hasSetTargets(ex.setTargets)
      ? { ...ex, ...deriveFromSetTargets(ex.setTargets) }
      : ex;
  }

  /**
   * What to write under one exercise of an update: the sent list; nothing for
   * an explicit `null`; and for an exercise sent without the field (an old
   * bundle), the stored rows when design G's preservation rule allows.
   */
  private resolveSetTargets(
    ex: CreateWorkoutExerciseInput,
    values: ReturnType<WorkoutRepository["toWorkoutExerciseInsert"]>,
    stored: Map<string, SetTarget[][]>,
  ): SetTarget[] | null {
    if (hasSetTargets(ex.setTargets)) return cloneSetTargets(ex.setTargets);
    if (ex.setTargets !== undefined) return null;
    return preservedSetTargets(stored, values);
  }

  /**
   * A Loadout variation's rows, with the parent's reps per set carried over.
   *
   * A row that sends `setTargets` keeps them (the preview returns the
   * parent's, so an updated phone echoes them). A row sent WITHOUT the field —
   * a 1.2.0 bundle, which never saw `setTargets` — gets the parent row's under
   * the same rule as an old-bundle edit: same position, same exercise (the
   * replaced one, for a swap) and the derived sets / range unchanged. So an
   * adaptation keeps 10 / 8 / 8 whichever bundle saved it.
   */
  private async variationRows(
    tx: DbOrTx,
    parentId: string,
    variationId: string,
    planned: CreateVariationExerciseInput[],
  ): Promise<ExerciseInsert[]> {
    const parentRows = await tx
      .select({
        exerciseId: workoutExercises.exerciseId,
        sortOrder: workoutExercises.sortOrder,
        setTargets: setTargetsJson,
      })
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, parentId))
      .orderBy(workoutExercises.sortOrder);
    const stored = indexStoredSetTargets(
      parentRows.map((row) => ({
        exerciseId: row.exerciseId,
        sortOrder: row.sortOrder,
        setTargets: row.setTargets ?? [],
      })),
    );

    return planned.map((ex) => {
      const values = this.toWorkoutExerciseInsert(variationId, ex);
      return {
        values: {
          ...values,
          substitutedFromExerciseId: ex.substitutedFromExerciseId ?? null,
          substitutionReason: ex.substitutionReason ?? null,
          isUserOverride: ex.isUserOverride ?? false,
        },
        setTargets: this.resolveSetTargets(
          ex,
          {
            ...values,
            exerciseId: ex.substitutedFromExerciseId ?? ex.exerciseId,
          },
          stored,
        ),
      };
    });
  }

  /**
   * Insert exercise rows, then the per-set rows under them.
   *
   * With no per-set targets anywhere this is exactly the old single INSERT.
   * Otherwise the INSERT returns ids in VALUES order (one multi-row INSERT
   * … RETURNING), and each row's targets are written as set 1…n.
   */
  private async insertExercises(
    tx: DbOrTx,
    rows: ExerciseInsert[],
  ): Promise<void> {
    if (!rows.some((row) => row.setTargets !== null)) {
      await tx.insert(workoutExercises).values(rows.map((row) => row.values));
      return;
    }
    const inserted = await tx
      .insert(workoutExercises)
      .values(rows.map((row) => row.values))
      .returning({ id: workoutExercises.id });
    const targetRows = inserted.flatMap((row, i) =>
      (rows[i].setTargets ?? []).map((target, n) => ({
        workoutExerciseId: row.id,
        setNumber: n + 1,
        targetReps: target.reps,
      })),
    );
    await tx.insert(workoutExerciseSetTargets).values(targetRows);
  }

  private toWorkoutExerciseInsert(
    workoutId: string,
    ex: CreateWorkoutExerciseInput,
  ) {
    return {
      workoutId,
      exerciseId: ex.exerciseId,
      sortOrder: ex.sortOrder,
      supersetGroup: ex.supersetGroup ?? null,
      targetSets: ex.targetSets ?? null,
      ...resolveWorkoutRepRange(ex),
      targetDurationSeconds: ex.targetDurationSeconds ?? null,
      restSeconds: ex.restSeconds ?? 90,
      notes: ex.notes ?? null,
    };
  }
}
