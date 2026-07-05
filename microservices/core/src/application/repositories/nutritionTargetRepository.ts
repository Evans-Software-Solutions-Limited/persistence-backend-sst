import { eq } from "drizzle-orm";
import { nutritionTargets, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";

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

  /**
   * Trainer on-behalf upsert (cross-cuts § 1.2 / § 1.5). Writes the client's
   * target AND stamps `set_by_user_id = setByUserId` so the client's Fuel
   * screen renders "Set by Coach X". Unlike the self `upsert`, this method
   * accepts a transaction handle so the write and the
   * `trainer_actions_audit` insert land in ONE transaction (cross-cuts
   * § 1.4.2), and it does NOT re-read — the caller re-reads via `get()`
   * post-commit for the `setByName`-enriched DTO.
   */
  async upsertForClient(
    clientId: string,
    input: UpsertTargetInput,
    setByUserId: string,
    tx?: DbOrTx,
  ): Promise<void> {
    const db = tx ?? getDb();
    await db
      .insert(nutritionTargets)
      .values({
        userId: clientId,
        dailyKcal: String(input.dailyKcal),
        proteinG: String(input.proteinG),
        carbsG: String(input.carbsG),
        fatG: String(input.fatG),
        waterCups: input.waterCups,
        preset: input.preset ?? "custom",
        setByUserId,
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
          setByUserId,
          updatedAt: new Date(),
        },
      });
  }
}
