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

const PLAIN_DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Compare two non-negative plain decimals exactly, digit by digit. */
function compareDecimal(a: string, b: string): number {
  const [aInt = "", aFrac = ""] = a.split(".");
  const [bInt = "", bFrac = ""] = b.split(".");
  const ai = aInt.replace(/^0+/, "");
  const bi = bInt.replace(/^0+/, "");
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai < bi ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const af = aFrac.padEnd(width, "0");
  const bf = bFrac.padEnd(width, "0");
  return af === bf ? 0 : af < bf ? -1 : 1;
}

/**
 * The value to store for a weight/distance column as a plain decimal, or null
 * when the column cannot hold it: not a finite number, negative, text that is
 * not a plain decimal (hex, binary, exponent, signed: JS parses some of these
 * but Postgres' numeric input rejects them, which would fail the whole
 * workout's transaction), or too big once Postgres rounds it to two places.
 *
 * Postgres does the rounding, exactly as it does for a set edit, so a value
 * stores the same whichever route it arrives by. The bound check therefore
 * works on the decimal digits, never on a float: `max` is the column's top
 * value (two places), and anything at or above `max` + 0.005 rounds past it
 * (9999.995 kg overflows numeric(6,2) exactly like 35532 did). Rounding the
 * double instead stored 1.005 as 1.00 (Inspector Brad, PR #532).
 */
export function storableSetValue(
  value: string | number | null | undefined,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  let decimal: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    // Below a millionth, `String` switches to exponent form; the column
    // stores it as 0 anyway.
    decimal = value < 1e-6 ? "0" : String(value);
    // Large numbers print in exponent form too; they are far past any max.
    if (!PLAIN_DECIMAL.test(decimal)) return null;
  } else {
    decimal = value.trim();
    if (!PLAIN_DECIMAL.test(decimal)) return null;
  }
  // Keep it short enough for Postgres' numeric input, which rejects a scale
  // above 16383 (Inspector Brad, PR #532): leading zeros go, and so do
  // fractional digits past the third, since rounding to two places (half away
  // from zero) reads only the third. What is stored does not change.
  decimal = decimal.replace(/^0+(?=\d)/, "").replace(/(\.\d{3})\d+$/, "$1");
  // `max` has two places ("9999.99"), so appending 5 gives the rounding edge.
  const firstUnstorable = `${String(max)}5`;
  if (compareDecimal(decimal, firstUnstorable) >= 0) return null;
  return decimal;
}
