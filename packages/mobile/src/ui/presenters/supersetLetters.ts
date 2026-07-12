/**
 * Map each MULTI-MEMBER superset group to a display letter (A, B, C…) in the
 * order groups first appear in the exercise list — so the creator/editor
 * badges match the detail screen's centred letter pill.
 *
 * A group with only one member renders as a plain standalone exercise in both
 * the creator (cluster `rows.length > 1` gate) and the detail (`buildPlan`
 * lone-member fallback), so it is skipped here — otherwise it would consume an
 * ordinal and shift the letters of later real supersets out of sync with the
 * detail. Pure + deterministic; groups beyond H fall back to a 1-based ordinal.
 */
const SUPERSET_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function buildSupersetLetterMap(
  groups: readonly (number | null)[],
): Map<number, string> {
  const counts = new Map<number, number>();
  for (const group of groups) {
    if (group === null) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const map = new Map<number, string>();
  let ordinal = 0;
  for (const group of groups) {
    if (group === null || map.has(group)) continue;
    // Lone-member groups render as singles (no badge) — don't spend a letter.
    if ((counts.get(group) ?? 0) < 2) continue;
    map.set(group, SUPERSET_LETTERS[ordinal] ?? `${ordinal + 1}`);
    ordinal += 1;
  }
  return map;
}
