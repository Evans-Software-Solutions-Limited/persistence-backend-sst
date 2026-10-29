/**
 * Hydrate-recent-sets command — backfills the device-local "Previous" hint
 * cache (`recent_sets`) from the server on a fresh install.
 *
 * Why this exists: V2's previous-set hints are written ONLY when a session is
 * completed on THIS device (see `completeSessionCommand`), with no server→
 * device backfill. So a fresh install — a new phone, an App Store install
 * after TestFlight, or a reinstall — starts with empty hints even though the
 * full set history is safe on the server. This command closes that gap by
 * pulling the user's recent sets from `GET /sessions/recent-sets` and upserting
 * them into the local cache.
 *
 * Clobber-safety: it runs ONLY when the local cache is empty
 * (`storage.hasAnyRecentSets` is false). A returning device already has its
 * own — possibly fresher, offline-logged — entries, and hydrating there could
 * overwrite a newer local attempt with older server data, so we skip it. The
 * fresh-install case is exactly "cache empty", which is what we target.
 *
 * Non-fatal by contract: the "Previous" chips are a convenience hint, so a
 * failed fetch returns the error for the caller to swallow — never blocks the
 * signed-in surface from rendering.
 */

import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { ApiError } from "@/shared/errors";
import { ok, type Result } from "@/shared/errors";

export type HydrateRecentSetsDeps = {
  storage: Pick<StoragePort, "hasAnyRecentSets" | "upsertRecentSets">;
  api: Pick<ApiPort, "getRecentSets">;
  userId: string;
};

export type HydrateRecentSetsResult = {
  /** Number of recent-set rows written into the local cache (0 if skipped). */
  hydrated: number;
  /** True when the cache already held entries, so the fetch was skipped. */
  skipped: boolean;
};

export async function hydrateRecentSetsCommand(
  deps: HydrateRecentSetsDeps,
): Promise<Result<HydrateRecentSetsResult, ApiError>> {
  // Returning device — already has local hints. Never clobber possibly-fresher
  // offline entries with older server data.
  if (deps.storage.hasAnyRecentSets(deps.userId)) {
    return ok({ hydrated: 0, skipped: true });
  }

  const res = await deps.api.getRecentSets();
  if (!res.ok) return res;

  if (res.value.length > 0) {
    deps.storage.upsertRecentSets(deps.userId, res.value);
  }
  return ok({ hydrated: res.value.length, skipped: false });
}
