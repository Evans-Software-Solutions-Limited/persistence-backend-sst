import { useEffect, useRef } from "react";
import { hydrateRecentSetsCommand } from "@/application/commands/session/hydrate-recent-sets.command";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * One-shot-per-login backfill of the local "Previous" hint cache from the
 * server. Mounted at the authenticated layout root so it runs once for the
 * signed-in surface (and re-runs after a sign-out → sign-in as a different
 * user, keyed on `userId`).
 *
 * The command itself is a no-op when the cache already has entries, so this is
 * effectively "hydrate on a fresh install". Failures are swallowed — the hints
 * are a convenience, never a blocker — and the per-user guard is cleared on
 * failure so a later launch can retry.
 *
 * See `hydrateRecentSetsCommand` for the fresh-install rationale and the
 * clobber-safety reasoning.
 */
export function useHydrateRecentSets(): void {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const ranForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (userId === null) return;
    if (ranForUserRef.current === userId) return;
    // Guard BEFORE the async call so a double-render can't fire two fetches.
    ranForUserRef.current = userId;

    void hydrateRecentSetsCommand({ storage, api, userId }).then((result) => {
      // Transient failure (e.g. offline at first launch): clear the guard so a
      // later remount/launch retries rather than leaving hints blank forever.
      if (!result.ok && ranForUserRef.current === userId) {
        ranForUserRef.current = null;
      }
    });
  }, [userId, storage, api]);
}
