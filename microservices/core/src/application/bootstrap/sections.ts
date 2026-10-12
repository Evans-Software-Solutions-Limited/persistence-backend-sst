/**
 * The sections `GET /users/me/bootstrap` can return. Keys are stable wire
 * identifiers; the mobile client sends the ones whose caches are stale.
 * Spec: specs/milestones/COLD-START-BOOTSTRAP/BRIEF.md.
 */
export const BOOTSTRAP_SECTIONS = [
  "home",
  "profile",
  "subscription",
  "tiers",
  "onboarding",
  "workouts",
  "notifications",
  "habitConfig",
  "habitCompletions",
  "streaks",
  "achievements",
  "volumeStats",
  "bodyTrend",
  "recentPRs",
  "muscleGroups",
  "equipment",
] as const;

export type BootstrapSection = (typeof BOOTSTRAP_SECTIONS)[number];

const KNOWN = new Set<string>(BOOTSTRAP_SECTIONS);

export function isBootstrapSection(value: string): value is BootstrapSection {
  return KNOWN.has(value);
}

/**
 * Parses the comma-separated `include` query. Absent or empty means every
 * section. Returns the unknown keys so the route can answer 400 with them.
 */
export function parseInclude(
  include: string | undefined,
):
  | { ok: true; sections: readonly BootstrapSection[] }
  | { ok: false; unknown: string[] } {
  if (include === undefined || include.trim() === "")
    return { ok: true, sections: BOOTSTRAP_SECTIONS };
  const keys = include
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const unknown = keys.filter((k) => !isBootstrapSection(k));
  if (unknown.length > 0) return { ok: false, unknown };
  const seen = new Set<BootstrapSection>();
  for (const key of keys) seen.add(key as BootstrapSection);
  return { ok: true, sections: BOOTSTRAP_SECTIONS.filter((s) => seen.has(s)) };
}
