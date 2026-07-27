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
  /**
   * Grouping for Loadout's manual equipment picker (spec-21 § 2.3b, AC-2.2):
   * `free_weights | machines | cables | bodyweight | cardio | accessories`.
   *
   * Only meaningful for `kind: "equipment"`, hence optional. **The three states
   * are distinct and the picker depends on it:**
   *
   * - a **string** — the server's category;
   * - **`null`** — the server says this row is uncategorised (renders under
   *   "Other", still selectable);
   * - **absent (`undefined`)** — this entry came from a CACHE written before the
   *   field existed. Treat that as "grouping unknown, refresh the list", not as
   *   uncategorised: the 24h staleness window would otherwise leave a returning
   *   user with every chip in one "Other" bucket. See `isEquipmentGroupingStale`.
   */
  category?: string | null;
};

/**
 * Does this cached equipment list predate `category` (spec-21 Phase 0)?
 *
 * A pre-Loadout cache entry has no `category` key at all, which is
 * indistinguishable from "uncategorised" unless the absence is checked
 * explicitly — so the picker asks this before trusting the cache for grouping.
 * An empty list is NOT stale: there is nothing to group and a refresh would be
 * pointless churn.
 */
export function isEquipmentGroupingStale(
  entries: readonly ReferenceEntry[],
): boolean {
  return entries.length > 0 && entries.some((entry) => !("category" in entry));
}

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
