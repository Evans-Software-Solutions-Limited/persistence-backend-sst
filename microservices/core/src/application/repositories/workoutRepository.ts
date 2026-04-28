import { and, eq, ne, or, desc, inArray, count } from "drizzle-orm";
import {
  workouts,
  workoutExercises,
  exercises,
  friendships,
  workoutAssignments,
  userSubscriptions,
  subscriptionTiers,
  type Workout,
} from "@persistence/db";
import { getDb, type Db } from "@persistence/db/client";

export type WorkoutListType = "mine" | "assigned" | "default";

export interface ListWorkoutsFilters {
  type?: WorkoutListType;
  limit?: number;
  offset?: number;
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
  exercises?: CreateWorkoutExerciseInput[];
}

export interface UpdateWorkoutInput {
  name?: string;
  description?: string | null;
  visibility?: "private" | "friends" | "public";
  estimatedDurationMinutes?: number;
  exercises?: CreateWorkoutExerciseInput[];
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

    const whereClause = this.buildListWhereClause(type, userId, db);

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

    const [existing] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!existing || existing.createdBy !== userId) {
      return null;
    }

    return db.transaction(async (tx) => {
      const metadata: Partial<Workout> = {};
      if (data.name !== undefined) metadata.name = data.name;
      if (data.description !== undefined)
        metadata.description = data.description;
      if (data.visibility !== undefined) metadata.visibility = data.visibility;
      if (data.estimatedDurationMinutes !== undefined)
        metadata.estimatedDurationMinutes = data.estimatedDurationMinutes;

      const [updated] = await tx
        .update(workouts)
        .set({ ...metadata, updatedAt: new Date() })
        .where(eq(workouts.id, id))
        .returning();

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

    const [existing] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!existing || existing.createdBy !== userId) {
      return false;
    }

    const result = await db
      .delete(workouts)
      .where(eq(workouts.id, id))
      .returning();

    return !!result[0];
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private buildListWhereClause(type: WorkoutListType, userId: string, db: Db) {
    if (type === "mine") {
      return eq(workouts.createdBy, userId);
    }
    if (type === "assigned") {
      const assignedIds = db
        .select({ workoutId: workoutAssignments.workoutId })
        .from(workoutAssignments)
        .where(eq(workoutAssignments.clientId, userId));
      return inArray(workouts.id, assignedIds);
    }
    // default — public, but exclude user's own publics (those show under "mine")
    return and(
      eq(workouts.visibility, "public"),
      ne(workouts.createdBy, userId),
    );
  }

  private async canRead(
    db: DbOrTx,
    workout: Workout,
    userId: string,
  ): Promise<boolean> {
    if (workout.createdBy === userId) return true;
    if (workout.visibility === "public") return true;
    if (workout.visibility === "friends") {
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
      return friendship.length > 0;
    }
    return false; // private, non-owner
  }

  private async fetchWorkoutWithExercises(
    db: DbOrTx,
    workout: Workout,
  ): Promise<WorkoutWithExercises> {
    const exerciseRows = await db
      .select({
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
      .where(eq(workoutExercises.workoutId, workout.id))
      .orderBy(workoutExercises.sortOrder);

    return { ...workout, exercises: exerciseRows };
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
      .orderBy(workoutExercises.sortOrder);

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
