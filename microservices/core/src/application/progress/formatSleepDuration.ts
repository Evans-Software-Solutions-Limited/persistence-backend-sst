/**
 * Formats a sleep duration in minutes for the Home "sleep" micro-pill
 * (specs/20-sleep-quicklog STORY-001 AC 1.5 / STORY-002 AC 2.5, design.md
 * § Home pill wiring): `450 → "7h 30m"`, `45 → "45m"`, `null → null`.
 */
export function formatSleepDuration(
  minutes: number | null | undefined,
): string | null {
  if (minutes === null || minutes === undefined) return null;

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  return hours > 0 ? `${hours}h ${remainderMinutes}m` : `${remainderMinutes}m`;
}
