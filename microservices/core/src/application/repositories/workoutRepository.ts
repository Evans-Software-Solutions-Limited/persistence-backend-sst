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
  exercises,
  friendships,
  workoutAssignments,
  userSubscriptions,
  subscriptionTiers,
  workoutSessions,
  sessionExercises,
  exerciseSets,
  profiles,
  type Workout,
} from "@persistence/db";
import { getDb, type Db } from "@persistence/db/client";

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
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetDurationSeconds?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
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

    const [usedRow, tierRow] = await Promise.all([
      db
        .select({ value: count() })
        .from(workouts)
        .where(eq(workouts.createdBy, userId)),
      db
        .select({ workoutLimit: subscriptionTiers.workoutLimit })
        .from(userSubscriptions)
        .innerJoin(
          subscriptionTiers,
          eq(userSubscriptions.tierName, subscriptionTiers.tierName),
        )
        .where(
          and(
            eq(userSubscriptions.userId, userId),
            inArray(userSubscriptions.paymentStatus, ["active", "pending"]),
          ),
        )
        .limit(1),
    ]);

    return {
      used: usedRow[0].value,
      limit: tierRow[0]?.workoutLimit ?? null,
    };
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

  async createWithExercises(
    userId: string,
    input: CreateWorkoutInput,
  ): Promise<WorkoutWithExercises> {
    const db = getDb();

    return db.transaction(async (tx) => {
      const [workout] = await tx
        .insert(workouts)
        .values({
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility ?? "private",
          estimatedDurationMinutes: input.estimatedDurationMinutes ?? 30,
          // Absent => true (personal). Coach-authoring flow sends false.
          showInOwnerLibrary: input.showInOwnerLibrary ?? true,
          createdBy: userId,
        })
        .returning();

      if (input.exercises && input.exercises.length > 0) {
        await tx
          .insert(workoutExercises)
          .values(
            input.exercises.map((ex) =>
              this.toWorkoutExerciseInsert(workout.id, ex),
            ),
          );
      }

      return this.fetchWorkoutWithExercises(tx, workout);
    });
  }

  async update(
    id: string,
    userId: string,
    data: UpdateWorkoutInput,
  ): Promise<WorkoutWithExercises | null> {
    const db = getDb();

    return db.transaction(async (tx) => {
      const metadata: Partial<Workout> = {};
      if (data.name !== undefined) metadata.name = data.name;
      if (data.description !== undefined)
        metadata.description = data.description;
      if (data.visibility !== undefined) metadata.visibility = data.visibility;
      if (data.estimatedDurationMinutes !== undefined)
        metadata.estimatedDurationMinutes = data.estimatedDurationMinutes;
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

      if (data.exercises !== undefined) {
        // Full-replacement: wipe junction rows + insert new array.
        await tx
          .delete(workoutExercises)
          .where(eq(workoutExercises.workoutId, id));

        if (data.exercises.length > 0) {
          await tx
            .insert(workoutExercises)
            .values(
              data.exercises.map((ex) => this.toWorkoutExerciseInsert(id, ex)),
            );
        }
      }

      return this.fetchWorkoutWithExercises(tx, updated);
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
  ) {
    if (type === "mine") {
      // `ownerLibraryOnly` de-crowds a trainer's personal My Workouts: only
      // workouts they authored AND flagged owner-visible. The client sends it
      // for trainers only; regular athletes never set it, so `mine` stays
      // "everything I created" for them (unchanged). Only meaningful for
      // type="mine" — assigned/default ignore it.
      return ownerLibraryOnly
        ? and(
            eq(workouts.createdBy, userId),
            eq(workouts.showInOwnerLibrary, true),
          )
        : eq(workouts.createdBy, userId);
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
      return inArray(workouts.id, assignedIds);
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
      const { workoutId, ...rest } = row;
      const list = grouped.get(workoutId) ?? [];
      list.push(rest);
      grouped.set(workoutId, list);
    }

    return grouped;
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
      targetRepsMin: ex.targetRepsMin ?? 1,
      targetRepsMax: ex.targetRepsMax ?? 1,
      targetDurationSeconds: ex.targetDurationSeconds ?? null,
      restSeconds: ex.restSeconds ?? 90,
      notes: ex.notes ?? null,
    };
  }
}
