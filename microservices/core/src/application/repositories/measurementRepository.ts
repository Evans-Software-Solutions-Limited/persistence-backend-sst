import { eq, desc } from "drizzle-orm";
import {
  bodyMeasurements,
  type BodyMeasurement,
  type NewBodyMeasurement,
} from "@persistence/db";
import { getDb, type Db } from "@persistence/db/client";

// Drizzle's transaction callback receives a typed PgTransaction; the public
// `Db` type captures the same query API surface so a helper can accept either
// the singleton or a transaction handle. Same structural alias as
// `WorkoutRepository`'s `DbOrTx` — keeps this free of Drizzle's deep
// generic types.
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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
    tx?: DbOrTx,
  ): Promise<BodyMeasurement> {
    const db = tx ?? getDb();

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
