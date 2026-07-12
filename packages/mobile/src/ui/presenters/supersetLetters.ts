/**
 * Map each distinct superset group to a display letter (A, B, C…) in the
 * order groups first appear in the exercise list — so the creator/editor
 * badges match the detail screen's centred letter pill.
 *
 * Pure + deterministic. Groups beyond H fall back to their 1-based ordinal.
 */
const SUPERSET_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function buildSupersetLetterMap(
  groups: readonly (number | null)[],
): Map<number, string> {
  const map = new Map<number, string>();
  let ordinal = 0;
  for (const group of groups) {
    if (group === null || map.has(group)) continue;
    map.set(group, SUPERSET_LETTERS[ordinal] ?? `${ordinal + 1}`);
    ordinal += 1;
  }
  return map;
}
