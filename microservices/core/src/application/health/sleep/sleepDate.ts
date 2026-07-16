// Shared sleep-date validation for the /health/sleep handlers.
//
// The typebox `pattern` gate only enforces the YYYY-MM-DD *shape* — it happily
// accepts calendar-impossible values like `2026-13-45` or `2026-02-30`. The
// underlying `sleep_data.sleep_date` column is a Postgres `DATE`, so such a
// value would reach the DB and raise `22008` → an unfriendly 500. Validate the
// calendar date up front and 422 instead (Inspector Brad PR-A finding).

// YYYY-MM-DD shape. Matches the `ISO_DATE_PATTERN` precedent in
// application/trainers/programs/shared.ts.
export const SLEEP_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * True iff `value` is a real calendar date in `YYYY-MM-DD` form. Rejects
 * impossible months/days (e.g. `2026-13-45`, `2026-02-30`) that pass the shape
 * regex but would 500 at the `DATE` column.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Round-trips only when the components form a real date (JS Date would
  // otherwise roll `2026-02-30` over to March).
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}
