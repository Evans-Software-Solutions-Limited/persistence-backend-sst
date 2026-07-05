import { and, eq, desc } from "drizzle-orm";
import { userGoals, type UserGoal, type NewUserGoal } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";

export class GoalRepository {
  static readonly key = "GoalRepository";

  async list(userId: string, limit = 20, offset = 0): Promise<UserGoal[]> {
    const db = getDb();

    return db
      .select()
      .from(userGoals)
      .where(eq(userGoals.userId, userId))
      .orderBy(desc(userGoals.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getById(id: string, userId: string): Promise<UserGoal | null> {
    const db = getDb();

    const result = await db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.id, id), eq(userGoals.userId, userId)))
      .limit(1);

    return result[0] ?? null;
  }

  async create(
    userId: string,
    data: Omit<NewUserGoal, "userId" | "createdAt" | "updatedAt">,
    // Optional transaction handle — the coach on-behalf goal-assign write
    // threads its `db.transaction` handle through here so the goal insert and
    // the `trainer_actions_audit` insert land in ONE transaction (cross-cuts
    // § 1.4.2). Same optional-`tx` pattern as `MeasurementRepository.create`.
    tx?: DbOrTx,
  ): Promise<UserGoal> {
    const db = tx ?? getDb();

    const result = await db
      .insert(userGoals)
      .values({
        ...data,
        userId,
      } as NewUserGoal)
      .returning();

    return result[0];
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<UserGoal, "id" | "userId" | "createdAt">>,
  ): Promise<UserGoal | null> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.id, id), eq(userGoals.userId, userId)))
      .limit(1);

    if (!existing[0]) {
      return null;
    }

    const result = await db
      .update(userGoals)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(userGoals.id, id))
      .returning();

    return result[0] ?? null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.id, id), eq(userGoals.userId, userId)))
      .limit(1);

    if (!existing[0]) {
      return false;
    }

    const result = await db
      .delete(userGoals)
      .where(eq(userGoals.id, id))
      .returning();

    return !!result[0];
  }
}
