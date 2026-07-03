/** Server-side "today" (UTC, YYYY-MM-DD) — anchors scheduling + week maths. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD wire-format guard for date fields. */
export const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
