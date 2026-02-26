import { and, eq, or, desc } from "drizzle-orm";
import {
  workouts,
  workoutExercises,
  exercises,
  friendships,
  type Workout,
  type NewWorkout,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface ListWorkoutsFilters {
  type?: "mine" | "assigned" | "default";
  limit?: number;
  offset?: number;
}

export interface WorkoutWithExercises extends Workout {
  exercises: Array<{
    id: string;
    exerciseId: string;
    sortOrder: number;
    targetSets: number | null;
    targetRepsMin: number;
    targetRepsMax: number;
    targetDurationSeconds: number | null;
    restSeconds: number | null;
    notes: string | null;
    exercise?: {
      id: string;
      name: string;
      category: string;
      difficultyLevel: string;
      videoUrl: string | null;
      thumbnailUrl: string | null;
    } | null;
  }>;
}

export class WorkoutRepository {
  static readonly key = "WorkoutRepository";

  async list(userId: string, filters: ListWorkoutsFilters): Promise<Workout[]> {
    const db = getDb();

    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    const type = filters.type ?? "mine";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let conditions: any = [];

    if (type === "mine") {
      // Own workouts
      conditions = [eq(workouts.createdBy, userId)];
    } else if (type === "assigned") {
      // Workouts assigned to the user (via workoutAssignments)
      // For now, just return mine — assigned would need a subquery join
      conditions = [eq(workouts.createdBy, userId)];
    } else if (type === "default") {
      // Public workouts
      conditions = [eq(workouts.visibility, "public")];
    } else {
      // All accessible: own + assigned + public
      // For simplicity, return own + public
      conditions = [
        or(eq(workouts.createdBy, userId), eq(workouts.visibility, "public")),
      ];
    }

    const query = db
      .select()
      .from(workouts)
      .where(and(...conditions))
      .orderBy(desc(workouts.createdAt))
      .limit(limit)
      .offset(offset);

    return query;
  }

  async getById(
    id: string,
    userId: string,
  ): Promise<WorkoutWithExercises | null> {
    const db = getDb();

    const result = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    const workout = result[0];
    if (!workout) {
      return null;
    }

    // Owner always has access
    if (workout.createdBy === userId) {
      // fall through to fetch exercises
    } else if (workout.visibility === "public") {
      // fall through to fetch exercises
    } else if (workout.visibility === "friends") {
      // Verify an accepted friendship exists in either direction
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

      if (friendship.length === 0) {
        return null;
      }
    } else {
      // private — only owner (already handled above)
      return null;
    }

    // Fetch exercises for this workout
    const workoutExerciseResults = await db
      .select({
        id: workoutExercises.id,
        exerciseId: workoutExercises.exerciseId,
        sortOrder: workoutExercises.sortOrder,
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
      .where(eq(workoutExercises.workoutId, id))
      .orderBy(workoutExercises.sortOrder);

    return {
      ...workout,
      exercises: workoutExerciseResults,
    };
  }

  async create(
    userId: string,
    data: Omit<NewWorkout, "createdBy" | "createdAt" | "updatedAt" | "id">,
  ): Promise<Workout> {
    const db = getDb();

    const result = await db
      .insert(workouts)
      .values({
        ...data,
        createdBy: userId,
      } as NewWorkout)
      .returning();

    return result[0];
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<Workout, "id" | "createdBy" | "createdAt">>,
  ): Promise<Workout | null> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!existing[0] || existing[0].createdBy !== userId) {
      return null;
    }

    const result = await db
      .update(workouts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, id))
      .returning();

    return result[0] ?? null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, id))
      .limit(1);

    if (!existing[0] || existing[0].createdBy !== userId) {
      return false;
    }

    const result = await db
      .delete(workouts)
      .where(eq(workouts.id, id))
      .returning();

    return !!result[0];
  }
}
