/**
 * computeAge — derive whole-years age from a date-of-birth string.
 *
 * Spec: specs/08-profile-settings/requirements.md STORY-010 (AC 10.2, 10.5)
 *       specs/08-profile-settings/design.md § C (DOB / age)
 *
 * Store DOB, derive age — age is NEVER persisted. The ProfileDrawer's
 * Profile-details sub renders the derived value; `useProfilePage` surfaces
 * `dateOfBirth` from the `profiles.date_of_birth` column.
 *
 * Returns `null` when DOB is unset, malformed, or in the future (a future
 * DOB is treated as "unknown" rather than a negative age). Age is computed
 * in whole years, decrementing when the current date is before this year's
 * birthday — leap-day birthdays (Feb 29) tick over on Mar 1 in common years.
 */
export function computeAge(
  dateOfBirth: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (dateOfBirth == null || dateOfBirth === "") return null;

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  // Compare on calendar date (UTC) to avoid tz-of-`now` skew flipping a
  // birthday by a day. `dateOfBirth` is a `YYYY-MM-DD` string parsed as UTC
  // midnight; mirror that for `now`.
  const nowY = now.getUTCFullYear();
  const nowM = now.getUTCMonth();
  const nowD = now.getUTCDate();
  const dobY = dob.getUTCFullYear();
  const dobM = dob.getUTCMonth();
  const dobD = dob.getUTCDate();

  let age = nowY - dobY;
  // Not yet had this year's birthday → subtract one.
  if (nowM < dobM || (nowM === dobM && nowD < dobD)) {
    age -= 1;
  }

  if (age < 0) return null; // future DOB → unknown
  return age;
}
