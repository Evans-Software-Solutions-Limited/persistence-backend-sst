import { and, eq, desc } from "drizzle-orm";
import {
  workoutSessions,
  sessionExercises,
  exerciseSets,
  type WorkoutSession,
  type NewWorkoutSession,
  type SessionExercise,
  type NewSessionExercise,
  type ExerciseSet,
  type NewExerciseSet,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface SessionWithExercises extends WorkoutSession {
  exercises: SessionExercise[];
}

export class SessionRepository {
  static readonly key = "SessionRepository";

  async list(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<WorkoutSession[]> {
    const db = getDb();

    return db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(limit)
      .offset(offset);
  }

  async getById(
    id: string,
    userId: string,
  ): Promise<SessionWithExercises | null> {
    const db = getDb();

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!session[0]) {
      return null;
    }

    const exercises = await db
      .select({
        id: sessionExercises.id,
        sessionId: sessionExercises.sessionId,
        exerciseId: sessionExercises.exerciseId,
        sortOrder: sessionExercises.sortOrder,
        supersetGroup: sessionExercises.supersetGroup,
        isSubstituted: sessionExercises.isSubstituted,
        originalExerciseId: sessionExercises.originalExerciseId,
        notes: sessionExercises.notes,
        createdAt: sessionExercises.createdAt,
      })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, id))
      .orderBy(sessionExercises.sortOrder);

    return {
      ...session[0],
      exercises,
    };
  }

  async create(
    userId: string,
    data: Omit<NewWorkoutSession, "userId" | "startedAt" | "createdAt">,
  ): Promise<WorkoutSession> {
    const db = getDb();

    const result = await db
      .insert(workoutSessions)
      .values({
        ...data,
        userId,
      } as NewWorkoutSession)
      .returning();

    return result[0];
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<WorkoutSession, "id" | "userId" | "createdAt">>,
  ): Promise<WorkoutSession | null> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!existing[0]) {
      return null;
    }

    const result = await db
      .update(workoutSessions)
      .set(data)
      .where(eq(workoutSessions.id, id))
      .returning();

    return result[0] ?? null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!existing[0]) {
      return false;
    }

    const result = await db
      .delete(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .returning();

    return !!result[0];
  }

  // Session Exercise operations
  async addExercise(
    data: Omit<NewSessionExercise, "createdAt" | "id">,
  ): Promise<SessionExercise> {
    const db = getDb();

    const result = await db
      .insert(sessionExercises)
      .values(data as NewSessionExercise)
      .returning();

    return result[0];
  }

  async getSessionExercises(sessionId: string): Promise<SessionExercise[]> {
    const db = getDb();

    return db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId))
      .orderBy(sessionExercises.sortOrder);
  }

  async removeExercise(exerciseId: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership by checking if session belongs to user
    const sessionExercise = await db
      .select({ sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(eq(sessionExercises.id, exerciseId))
      .limit(1);

    if (!sessionExercise[0]) {
      return false;
    }

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, sessionExercise[0].sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session[0]) {
      return false;
    }

    const result = await db
      .delete(sessionExercises)
      .where(eq(sessionExercises.id, exerciseId))
      .returning();

    return !!result[0];
  }

  // Exercise Set operations
  async addSet(data: Omit<NewExerciseSet, "createdAt">): Promise<ExerciseSet> {
    const db = getDb();

    const result = await db
      .insert(exerciseSets)
      .values(data as NewExerciseSet)
      .returning();

    return result[0];
  }

  async getExerciseSets(sessionExerciseId: string): Promise<ExerciseSet[]> {
    const db = getDb();

    return db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.sessionExerciseId, sessionExerciseId))
      .orderBy(exerciseSets.setNumber);
  }

  /**
   * Returns the set only if it belongs to the given session exercise and
   * session (and session belongs to user). Used to enforce URL hierarchy.
   */
  async getSetInSession(
    sessionId: string,
    sessionExerciseId: string,
    setId: string,
    userId: string,
  ): Promise<ExerciseSet | null> {
    const db = getDb();

    const rows = await db
      .select({ set: exerciseSets })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(exerciseSets.id, setId),
          eq(exerciseSets.sessionExerciseId, sessionExerciseId),
          eq(sessionExercises.sessionId, sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    return rows[0]?.set ?? null;
  }

  async updateSet(
    setId: string,
    userId: string,
    data: Partial<Omit<ExerciseSet, "id" | "createdAt">>,
  ): Promise<ExerciseSet | null> {
    const db = getDb();

    // Verify ownership by checking if set's session belongs to user
    const setRecord = await db
      .select({ sessionExerciseId: exerciseSets.sessionExerciseId })
      .from(exerciseSets)
      .where(eq(exerciseSets.id, setId))
      .limit(1);

    if (!setRecord[0]) {
      return null;
    }

    const sessionExercise = await db
      .select({ sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(eq(sessionExercises.id, setRecord[0].sessionExerciseId))
      .limit(1);

    if (!sessionExercise[0]) {
      return null;
    }

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, sessionExercise[0].sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session[0]) {
      return null;
    }

    const result = await db
      .update(exerciseSets)
      .set(data)
      .where(eq(exerciseSets.id, setId))
      .returning();

    return result[0] ?? null;
  }

  async deleteSet(setId: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership by checking if set's session belongs to user
    const setRecord = await db
      .select({ sessionExerciseId: exerciseSets.sessionExerciseId })
      .from(exerciseSets)
      .where(eq(exerciseSets.id, setId))
      .limit(1);

    if (!setRecord[0]) {
      return false;
    }

    const sessionExercise = await db
      .select({ sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(eq(sessionExercises.id, setRecord[0].sessionExerciseId))
      .limit(1);

    if (!sessionExercise[0]) {
      return false;
    }

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, sessionExercise[0].sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session[0]) {
      return false;
    }

    const result = await db
      .delete(exerciseSets)
      .where(eq(exerciseSets.id, setId))
      .returning();

    return !!result[0];
  }
}
