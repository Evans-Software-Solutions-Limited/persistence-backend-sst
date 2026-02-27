import { eq, and, desc } from "drizzle-orm";
import {
  personalRecords,
  type PersonalRecord,
  type NewPersonalRecord,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export class RecordRepository {
  static readonly key = "RecordRepository";

  async list(userId: string, exerciseId?: string): Promise<PersonalRecord[]> {
    const db = getDb();

    let query = db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId))
      .orderBy(desc(personalRecords.achievedAt));

    if (exerciseId) {
      query = db
        .select()
        .from(personalRecords)
        .where(
          and(
            eq(personalRecords.userId, userId),
            eq(personalRecords.exerciseId, exerciseId),
          ),
        )
        .orderBy(desc(personalRecords.achievedAt));
    }

    return query;
  }

  async create(
    userId: string,
    data: Omit<NewPersonalRecord, "userId">,
  ): Promise<PersonalRecord> {
    const db = getDb();

    const result = await db
      .insert(personalRecords)
      .values({
        ...data,
        userId,
      } as NewPersonalRecord)
      .returning();

    return result[0];
  }
}
