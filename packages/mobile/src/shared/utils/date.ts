/**
 * isIsoDateString — validate a `YYYY-MM-DD` calendar date.
 *
 * Spec: specs/08-profile-settings/design.md § Revised 2026-05-31 § I
 *       (offline-first profile write) + § J (DOB validation, PR #94 bug 2)
 *
 * Rejects:
 *   - wrong shape ("1990", "1990-2-29", "1990/01/01")
 *   - impossible months/days ("1990-13-50")
 *   - non-leap Feb 29 ("1990-02-29" — 1990 isn't a leap year)
 *
 * Used by `updateProfileCommand` to gate the DOB before it's enqueued —
 * the offline sync worker POSTs the queued payload with no validation
 * feedback path, so an invalid date would 500 the server on every retry
 * (PR #94 medium-severity find). Validating client-side keeps the bad
 * value out of the queue entirely and surfaces a structured message.
 */
export function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Round-trip through a UTC Date: if any component is normalised away
  // (e.g. Feb 29 in a common year rolls to Mar 1), the input wasn't a
  // real calendar date.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
