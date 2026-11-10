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
 * For a single set edit, validating here turns that into a 422 at the edge,
 * and the repository never opens a transaction for a row Postgres cannot
 * store.
 *
 * Strings are bounded to the column scale (two fractional digits) as well
 * as its integer digits. Postgres rounds to scale BEFORE it checks
 * precision, and the carry can cross into the integer part — "9999.995"
 * rounds to 10000.00 and overflows numeric(6,2) exactly like 35532 did
 * (Inspector Brad, PR #510). Numbers are already safe through `maximum`.
 * Set create/update use these strict schemas. The two `sessions/record`
 * routes do not: a finished workout is never rejected for one value; see
 * `recordedSetValueSchema` below.
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

/**
 * The RECORD path's looser shape (PER-67 release, Brad 10 Nov 2026).
 *
 * `sessions/record` (self and on-behalf) carries a whole finished workout from
 * the sync queue. Rejecting it for one impossible value strands the entire
 * workout on the device: the only way out is Discard, which loses every other
 * set. That happened in production — a set logged at 35,532 kg (Sentry
 * PERSISTENCE-MOBILE-2) left one user pressing Retry for weeks. So the record
 * path accepts any number or string here and {@link storableSetValue} saves a
 * value the column cannot hold as blank; everything else in the workout saves.
 * Set create/update (a single edit the user is looking at) keep the strict
 * 422 schemas above.
 */
export const recordedSetValueSchema = t.Union([t.Number(), t.String()]);

/**
 * The value to store for a weight/distance column, as a plain decimal rounded
 * to the column's two places, or null when it cannot be stored: not a finite
 * number, negative, or above `max` once rounded (Postgres rounds before its
 * precision check, so 9999.995 kg would overflow exactly like 35532 did).
 */
const PLAIN_DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export function storableSetValue(
  value: string | number | null | undefined,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  // A string must be a plain decimal: hex, binary or exponent text is
  // nothing a person typed as a weight.
  if (typeof value === "string" && !PLAIN_DECIMAL.test(value.trim())) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded > max) return null;
  // Store the checked number, not the caller's text, so nothing Postgres'
  // numeric input could reject reaches the transaction (Inspector Brad, PR
  // #532). Rounded to the column's scale, it always prints as a plain decimal.
  return String(rounded);
}
