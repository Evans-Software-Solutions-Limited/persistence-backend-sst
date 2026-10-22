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
 * transaction for a row Postgres cannot store. Extra decimal places are
 * fine — `apply_typmod` rounds scale and only overflows on precision — so
 * the string patterns bound the integer digits and leave the fraction
 * open. Every route that writes these columns shares these schemas:
 * self + on-behalf `sessions/record`, and set create/update.
 */
export const WEIGHT_KG_MAX = 9999.99;
export const DISTANCE_METERS_MAX = 999999.99;

const WEIGHT_KG_PATTERN = "^(?:\\d{1,4}(?:\\.\\d+)?|\\.\\d+)$";
const DISTANCE_METERS_PATTERN = "^(?:\\d{1,6}(?:\\.\\d+)?|\\.\\d+)$";

export const weightKgSchema = t.Union([
  t.Number({ minimum: 0, maximum: WEIGHT_KG_MAX }),
  t.String({ pattern: WEIGHT_KG_PATTERN }),
]);

export const distanceMetersSchema = t.Union([
  t.Number({ minimum: 0, maximum: DISTANCE_METERS_MAX }),
  t.String({ pattern: DISTANCE_METERS_PATTERN }),
]);
