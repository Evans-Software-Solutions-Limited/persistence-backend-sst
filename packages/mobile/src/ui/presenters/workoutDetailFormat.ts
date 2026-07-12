/**
 * Pure display formatters for the workout-detail history block. Kept out of
 * the presenter so they're unit-testable without rendering (the presenter
 * imports these).
 *
 * Volume follows the app-wide convention (see `SessionSummaryPresenter`
 * `formatVolume`): kilograms, no lb conversion — the app never derives a
 * lb-volume anywhere, and the history panel is a read-only stat. Copy/units
 * are tunable (flagged in the PR).
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 10 (History block)
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Today" / "Yesterday" / "3d ago" / "2w ago" / "5mo ago" / "1y ago" from an
 * ISO timestamp. Returns null for an unparseable / empty input so the caller
 * can omit the stat rather than render "NaN". `now` is injectable for tests.
 */
export function formatRelativeDay(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now - then) / MS_PER_DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** "Mar 21" — locale-independent short date from an ISO timestamp. */
export function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
}

/** "6,240 kg" — rounded integer kilograms with thousands separators. */
export function formatVolumeKg(kg: number): string {
  const rounded = Math.max(0, Math.round(kg));
  return `${groupThousands(rounded)} kg`;
}

/** "44m" — mean/session seconds rounded to whole minutes. */
export function formatMinutesFromSeconds(
  seconds: number | null,
): string | null {
  if (seconds === null || Number.isNaN(seconds)) return null;
  return `${Math.max(0, Math.round(seconds / 60))}m`;
}

/** Deterministic thousands grouping (avoids locale-varying toLocaleString). */
function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
