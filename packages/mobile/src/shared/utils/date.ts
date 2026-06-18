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
/**
 * localDayISO — the DEVICE-LOCAL calendar date as `YYYY-MM-DD`.
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC date, which is a day
 * ahead/behind the user's real calendar day near midnight (e.g. 19:00 in
 * US-Pacific is already "tomorrow" in UTC; 09:00 in Auckland is still
 * "yesterday"). Habit days and the weigh-in default day are USER-LOCAL — the
 * backend treats a date-only habit `date` as the authoritative user-local day
 * (see `toggle-habit.command`), so the "today" anchor MUST be derived from
 * local components, not UTC, or a non-UTC user toggles/records the wrong day.
 *
 * Uses the device timezone (not `profiles.timezone`); the two agree for the
 * overwhelming majority, and the server reconciles any divergence on refresh
 * (server-wins per design.md § Offline behaviour).
 */
export function localDayISO(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * timeGreeting — "Good morning" / "Good afternoon" / "Good evening" for the
 * given local time (defaults to now). Matches the Home header greeting
 * (home.jsx HomeHeader). Boundaries: morning [05:00, 12:00), afternoon
 * [12:00, 18:00), evening otherwise.
 */
export function timeGreeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * weekStartMondayISO — the Monday (YYYY-MM-DD) of the week containing `dayISO`.
 *
 * Pure date-string arithmetic on an already-resolved calendar day (parse +
 * weekday + step in UTC so it's tz-independent — same approach as the
 * `addDaysISO` helpers). Used to render the habit grid as a fixed Mon→Sun week
 * (the cells + the day-letter header share this anchor so they align).
 */
export function weekStartMondayISO(dayISO: string): string {
  const d = new Date(`${dayISO}T00:00:00.000Z`);
  const weekday = d.getUTCDay(); // 0=Sun .. 6=Sat
  const sinceMonday = (weekday + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

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
