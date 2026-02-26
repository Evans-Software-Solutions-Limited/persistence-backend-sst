import { desc, eq, ilike, and, sql } from "drizzle-orm";
import { exercises, type Exercise } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface ListExercisesFilters {
  muscleGroup?: string;
  difficulty?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class ExerciseRepository {
  static readonly key = "ExerciseRepository";

  async list(filters: ListExercisesFilters): Promise<Exercise[]> {
    const db = getDb();

    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const conditions = [eq(exercises.isPublic, true)];

    if (filters.difficulty) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(eq(exercises.difficultyLevel, filters.difficulty as any));
    }

    if (filters.category) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(eq(exercises.category, filters.category as any));
    }

    if (filters.muscleGroup) {
      // primaryMuscles is a UUID array — filter by muscle group UUID
      conditions.push(
        sql`${filters.muscleGroup}::uuid = ANY(${exercises.primaryMuscles})`,
      );
    }

    if (filters.search) {
      const escaped = filters.search.replace(/[%_\\]/g, "\\$&");
      conditions.push(ilike(exercises.name, `%${escaped}%`));
    }

    const query = db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(desc(exercises.createdAt))
      .limit(limit)
      .offset(offset);

    return query;
  }

  async getById(id: string): Promise<Exercise | null> {
    const db = getDb();

    const result = await db
      .select()
      .from(exercises)
      .where(and(eq(exercises.id, id), eq(exercises.isPublic, true)))
      .limit(1);

    return result[0] ?? null;
  }
}
