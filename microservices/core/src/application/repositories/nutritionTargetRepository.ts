import { eq } from "drizzle-orm";
import { nutritionTargets, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/** Wire shape — macros as numbers (numeric→number boundary). */
export type NutritionTargetDTO = {
  userId: string;
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterCups: number;
  preset: string | null;
  setByUserId: string | null;
  /** Trainer display name when set_by_user_id is non-null (cross-cuts § 1.5). */
  setByName: string | null;
  updatedAt: string | null;
};

export type UpsertTargetInput = {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterCups: number;
  preset?: string;
};

export class NutritionTargetRepository {
  static readonly key = "NutritionTargetRepository";

  async get(userId: string): Promise<NutritionTargetDTO | null> {
    const db = getDb();
    const rows = await db
      .select({
        userId: nutritionTargets.userId,
        dailyKcal: nutritionTargets.dailyKcal,
        proteinG: nutritionTargets.proteinG,
        carbsG: nutritionTargets.carbsG,
        fatG: nutritionTargets.fatG,
        waterCups: nutritionTargets.waterCups,
        preset: nutritionTargets.preset,
        setByUserId: nutritionTargets.setByUserId,
        setByName: profiles.fullName,
        updatedAt: nutritionTargets.updatedAt,
      })
      .from(nutritionTargets)
      .leftJoin(profiles, eq(profiles.id, nutritionTargets.setByUserId))
      .where(eq(nutritionTargets.userId, userId))
      .limit(1);

    const r = rows[0];
    if (!r) return null;
    return {
      userId: r.userId,
      dailyKcal: Number(r.dailyKcal),
      proteinG: Number(r.proteinG),
      carbsG: Number(r.carbsG),
      fatG: Number(r.fatG),
      waterCups: r.waterCups,
      preset: r.preset,
      setByUserId: r.setByUserId,
      setByName: r.setByUserId ? (r.setByName ?? null) : null,
      updatedAt:
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : r.updatedAt
            ? String(r.updatedAt)
            : null,
    };
  }

  /**
   * Self-write upsert. `set_by_user_id` is intentionally NOT written here — it
   * is owned by the M8 trainer-on-behalf route; a user self-setting their
   * target leaves any existing trainer attribution untouched (per BACKEND_BRIEF
   * § 3).
   */
  async upsert(
    userId: string,
    input: UpsertTargetInput,
  ): Promise<NutritionTargetDTO> {
    const db = getDb();
    await db
      .insert(nutritionTargets)
      .values({
        userId,
        dailyKcal: String(input.dailyKcal),
        proteinG: String(input.proteinG),
        carbsG: String(input.carbsG),
        fatG: String(input.fatG),
        waterCups: input.waterCups,
        preset: input.preset ?? "custom",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: nutritionTargets.userId,
        set: {
          dailyKcal: String(input.dailyKcal),
          proteinG: String(input.proteinG),
          carbsG: String(input.carbsG),
          fatG: String(input.fatG),
          waterCups: input.waterCups,
          preset: input.preset ?? "custom",
          updatedAt: new Date(),
        },
      });

    // Re-read through get() so the response carries setByName consistently.
    const out = await this.get(userId);
    if (!out) throw new Error("nutrition_target_upsert_failed");
    return out;
  }
}
