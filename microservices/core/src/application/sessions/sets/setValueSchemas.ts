import { t } from "elysia";

/**
 * Request-side bounds for the two decimal columns on `exercise_sets`.
 *
 * `weight_kg` is `numeric(6,2)` and `distance_meters` is `numeric(8,2)`
 * (supabase/migrations/001_initial_schema.sql). Postgres rejects anything
 * whose integer part exceeds the column's precision with `22003 numeric
 * field overflow`, which the record path surfaced as a 500 on
 * `POST /sessions/record` (Sentry PERSISTENCE-BACKEND-8, 2026-10-22). A 500
 * is retryable to the mobile sync queue, so the same oversized payload
 * burned its whole retry budget and stranded the session in /sync-failed.
 *
 * Validating here turns that into a 422 at the edge: the queue classifies
 * it as permanent on the first attempt and the repository never opens a
 * transaction for a row Postgres cannot store.
 *
 * Strings are bounded to the column scale (two fractional digits) as well
 * as its integer digits. Postgres rounds to scale BEFORE it checks
 * precision, and the carry can cross into the integer part — "9999.995"
 * rounds to 10000.00 and overflows numeric(6,2) exactly like 35532 did
 * (Inspector Brad, PR #510). Numbers are already safe through `maximum`.
 * Every route that writes these columns shares these schemas: self +
 * on-behalf `sessions/record`, and set create/update.
 */
export const WEIGHT_KG_MAX = 9999.99;
export const DISTANCE_METERS_MAX = 999999.99;

const WEIGHT_KG_PATTERN = "^(?:\\d{1,4}(?:\\.\\d{1,2})?|\\.\\d{1,2})$";
const DISTANCE_METERS_PATTERN = "^(?:\\d{1,6}(?:\\.\\d{1,2})?|\\.\\d{1,2})$";

export const weightKgSchema = t.Union([
  t.Number({ minimum: 0, maximum: WEIGHT_KG_MAX }),
  t.String({ pattern: WEIGHT_KG_PATTERN }),
]);

export const distanceMetersSchema = t.Union([
  t.Number({ minimum: 0, maximum: DISTANCE_METERS_MAX }),
  t.String({ pattern: DISTANCE_METERS_PATTERN }),
]);
