import { eq } from "drizzle-orm";
import { profiles, type Profile } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export class ProfileRepository {
  static readonly key = "ProfileRepository";

  async getById(userId: string): Promise<Profile | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    return result[0] ?? null;
  }

  async update(
    userId: string,
    data: Partial<Omit<Profile, "id" | "createdAt">>,
  ): Promise<Profile | null> {
    const db = getDb();

    const result = await db
      .update(profiles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, userId))
      .returning();

    return result[0] ?? null;
  }
}
