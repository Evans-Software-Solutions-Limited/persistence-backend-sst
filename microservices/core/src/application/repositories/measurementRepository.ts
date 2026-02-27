import { eq, desc } from "drizzle-orm";
import {
  bodyMeasurements,
  type BodyMeasurement,
  type NewBodyMeasurement,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export class MeasurementRepository {
  static readonly key = "MeasurementRepository";

  async list(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<BodyMeasurement[]> {
    const db = getDb();

    return db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(limit)
      .offset(offset);
  }

  async create(
    userId: string,
    data: Omit<NewBodyMeasurement, "userId">,
  ): Promise<BodyMeasurement> {
    const db = getDb();

    const result = await db
      .insert(bodyMeasurements)
      .values({
        ...data,
        userId,
      } as NewBodyMeasurement)
      .returning();

    return result[0];
  }
}
