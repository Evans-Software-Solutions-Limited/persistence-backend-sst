import { MEALPRINT_PREFERENCE_TABLES } from "@/adapters/storage/tables";
import type { MealprintPreferences } from "@/domain/models/mealprint";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's Mealprint food preferences
 * (`GET /nutrition/preferences`, spec-26 AC 1.3).
 *
 * ## ⚠ `enabled` is load-bearing here, and the DEFAULT is `false`
 *
 * Every consumer of this hook reads from SQLite synchronously whether or not it
 * fetches — that is what `useCachedResource` does with a disabled resource. So a
 * surface that only needs to KNOW the preferences (the Fuel entry card, deciding
 * whether to offer the first-run wizard) passes nothing and costs nothing, while
 * a surface the user has actually opened (the editor route, the suggest sheet)
 * passes `true` and refreshes.
 *
 * Defaulting to `false` rather than `true` is deliberate. The Fuel entry card
 * lives on a TAB, so an eager default would add a request to every cold launch —
 * and the launch fan-out that produced ~28 requests inside 100 ms against a
 * 10-concurrency Lambda quota (≈16 of them 503s) was built out of exactly this
 * kind of "harmless" mount fetch. The sheets that own this data pass their own
 * open state, so `false → true` still fires the one-shot mount refresh on the
 * first real open.
 *
 * ## ⚠ `null` means "unknown on this device", NOT "no preferences set"
 *
 * The endpoint is 404-free: with no row it answers the DEFAULTS with
 * `isDefault: true`. So `data === null` only ever means this device has not
 * fetched yet, and a consumer must not read it as "the user has no
 * preferences" — the two lead to different UI (unknown → let the flow fetch;
 * `isDefault: true` → offer the first-run wizard).
 *
 * Subscribed to `cached_mealprint_preferences` so an optimistic offline save from
 * the editor surfaces on the entry card and in the sheet without either of them
 * remembering a `reload()`.
 */
export function useMealprintPreferences(
  enabled = false,
): CachedResourceState<MealprintPreferences> {
  return useCachedResource<MealprintPreferences>({
    read: (storage, userId) => ({
      value: storage.getCachedMealprintPreferences(userId),
      // Always stale: preferences are small, change rarely, and are read at the
      // top of every generation — so when a surface has opted IN to fetching, it
      // wants the live values rather than whatever this device last saw. The
      // hook's mount auto-refresh is one-shot per user, so this is one request
      // per opened surface, not a poll.
      isStale: true,
    }),
    fetcher: (api) => api.getMealprintPreferences(),
    write: (storage, userId, value) => {
      storage.cacheMealprintPreferences(userId, value);
    },
    tables: MEALPRINT_PREFERENCE_TABLES,
    enabled,
  });
}
