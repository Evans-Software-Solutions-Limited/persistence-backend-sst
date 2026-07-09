import { and, eq, desc, asc, sql } from "drizzle-orm";
import {
  userGoals,
  goalTypes,
  profiles,
  type UserGoal,
  type NewUserGoal,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";

export interface GoalTypeRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  iconName: string | null;
}

/**
 * Enriched athlete-read shape for a goal. Mirrors the `nutritionTargetRepository`
 * pattern: the raw `user_goals` row LEFT JOINed with `goal_types` (type
 * name/icon/category) and `profiles` (the assigner's `full_name` when the goal
 * was coach-assigned). `targetValue` / `currentValue` are converted from the
 * Postgres `numeric` string boundary to `number`; timestamps to ISO strings.
 */
export interface UserGoalDTO {
  id: string;
  userId: string;
  goalTypeId: string;
  priority: number | null;
  isActive: boolean | null;
  targetDate: string | null;
  notes: string | null;
  assignedByUserId: string | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** From `goal_types` (LEFT JOIN) — null only if the type row is missing. */
  goalTypeName: string | null;
  goalTypeIconName: string | null;
  goalTypeCategory: string | null;
  /**
   * Assigner display name when `assigned_by_user_id` is non-null (coach-assigned
   * goal, cross-cuts § 1.5). Null for self-set goals.
   */
  assignedByName: string | null;
}

/** Columns selected for the enriched list/getById reads. */
const goalSelectColumns = {
  id: userGoals.id,
  userId: userGoals.userId,
  goalTypeId: userGoals.goalTypeId,
  priority: userGoals.priority,
  isActive: userGoals.isActive,
  targetDate: userGoals.targetDate,
  notes: userGoals.notes,
  assignedByUserId: userGoals.assignedByUserId,
  targetValue: userGoals.targetValue,
  currentValue: userGoals.currentValue,
  unit: userGoals.unit,
  createdAt: userGoals.createdAt,
  updatedAt: userGoals.updatedAt,
  goalTypeName: goalTypes.name,
  goalTypeIconName: goalTypes.iconName,
  goalTypeCategory: goalTypes.category,
  assignedByName: profiles.fullName,
} as const;

/** Raw shape returned by the enriched select (numeric→string, timestamp→Date). */
interface GoalSelectRow {
  id: string;
  userId: string;
  goalTypeId: string;
  priority: number | null;
  isActive: boolean | null;
  targetDate: string | null;
  notes: string | null;
  assignedByUserId: string | null;
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  goalTypeName: string | null;
  goalTypeIconName: string | null;
  goalTypeCategory: string | null;
  assignedByName: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : null;
}

function mapGoalRow(r: GoalSelectRow): UserGoalDTO {
  return {
    id: r.id,
    userId: r.userId,
    goalTypeId: r.goalTypeId,
    priority: r.priority ?? null,
    isActive: r.isActive ?? null,
    targetDate: r.targetDate ?? null,
    notes: r.notes ?? null,
    assignedByUserId: r.assignedByUserId ?? null,
    targetValue: r.targetValue != null ? Number(r.targetValue) : null,
    currentValue: r.currentValue != null ? Number(r.currentValue) : null,
    unit: r.unit ?? null,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    goalTypeName: r.goalTypeName ?? null,
    goalTypeIconName: r.goalTypeIconName ?? null,
    goalTypeCategory: r.goalTypeCategory ?? null,
    // Only surface the name when the goal was actually assigned by someone
    // (mirrors nutritionTargetRepository.get()).
    assignedByName: r.assignedByUserId ? (r.assignedByName ?? null) : null,
  };
}

export class GoalRepository {
  static readonly key = "GoalRepository";

  async listTypes(): Promise<GoalTypeRow[]> {
    const db = getDb();

    const rows = await db
      .select({
        id: goalTypes.id,
        name: goalTypes.name,
        description: goalTypes.description,
        category: goalTypes.category,
        iconName: goalTypes.iconName,
      })
      .from(goalTypes)
      .orderBy(sql`${goalTypes.category} ASC NULLS LAST`, asc(goalTypes.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      category: row.category ?? null,
      iconName: row.iconName ?? null,
    }));
  }

  async list(userId: string, limit = 20, offset = 0): Promise<UserGoalDTO[]> {
    const db = getDb();

    const rows = await db
      .select(goalSelectColumns)
      .from(userGoals)
      .leftJoin(goalTypes, eq(goalTypes.id, userGoals.goalTypeId))
      .leftJoin(profiles, eq(profiles.id, userGoals.assignedByUserId))
      .where(eq(userGoals.userId, userId))
      .orderBy(desc(userGoals.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(mapGoalRow);
  }

  async getById(id: string, userId: string): Promise<UserGoalDTO | null> {
    const db = getDb();

    const rows = await db
      .select(goalSelectColumns)
      .from(userGoals)
      .leftJoin(goalTypes, eq(goalTypes.id, userGoals.goalTypeId))
      .leftJoin(profiles, eq(profiles.id, userGoals.assignedByUserId))
      .where(and(eq(userGoals.id, id), eq(userGoals.userId, userId)))
      .limit(1);

    return rows[0] ? mapGoalRow(rows[0]) : null;
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
