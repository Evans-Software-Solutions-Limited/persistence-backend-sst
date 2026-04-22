/**
 * Reference-list domain model.
 *
 * Mobile holds a translation layer between its string enums
 * (`"chest"`, `"barbell"`, etc.) and the backend's UUID catalog. The
 * reference-list cache is the bridge. It's offline-first, reused
 * across feature areas (exercise taxonomies in M0; goal types,
 * measurement types to follow), and the foundation M0's filter
 * wire-format fix depends on.
 *
 * Shape matches the legacy `persistence-mobile` `{ id, name, display_name }`
 * response format (see `design.md § Reference-list endpoints`).
 * `name` is the canonical identifier (equal to the mobile enum string
 * where one exists). `displayName` is nullable — the UI falls back to
 * `name` when null (matches legacy equipment behaviour, where the
 * table has no `display_name` column).
 *
 * Spec: specs/03-exercise-library/design.md § Reference-List Cache
 *       · requirements.md AC 7.10, AC 7.14
 */

export type ReferenceListKind = "muscle_groups" | "equipment" | "categories";

export type ReferenceEntry = {
  /** UUID from backend. Sent back in filter queries. */
  id: string;
  /**
   * Canonical identifier. For muscle_groups and equipment this equals the
   * mobile enum string (`"chest"`, `"barbell"`). For the M0 categories
   * shim (backend returns `string[]`), the adapter synthesises `id` and
   * sets `name` to the category value.
   */
  name: string;
  /**
   * Human-facing label. Nullable — equipment rows have no display_name
   * column in the backend today; the handler emits `null` for consistency.
   * UI: `displayName ?? name`.
   */
  displayName: string | null;
};

export type ReferenceList = {
  kind: ReferenceListKind;
  entries: ReferenceEntry[];
  /** ISO timestamp when the list was last fetched from the backend. */
  syncedAt: string;
};

/** 24 hours in ms — shared staleness constant for reference-list cache. */
export const REFERENCE_LIST_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Pure helper to check staleness. Separate from the application query so
 * both the React hook and the sync engine can use it without coupling.
 */
export function isReferenceListStale(
  list: ReferenceList | null,
  now: number = Date.now(),
  staleAfterMs: number = REFERENCE_LIST_STALE_AFTER_MS,
): boolean {
  if (!list) return true;
  const syncedAt = Date.parse(list.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}
