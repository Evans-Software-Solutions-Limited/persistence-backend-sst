import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  beginBootstrap,
  beginColdStart,
  endColdStart,
} from "@/application/bootstrap/gate";
import { runBootstrap } from "@/application/commands/bootstrap.command";
import { useUserMode } from "@/state/user-mode";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Runs the cold-start bootstrap once per signed-in user.
 *
 * The gate is opened during render (idempotent, module level) so the Home
 * hooks that mount in the same commit find it pending and wait, instead of
 * racing the single request with their own. Offline, failed or empty runs
 * settle the gate at once and the per-endpoint behaviour applies unchanged.
 * Spec: specs/milestones/COLD-START-BOOTSTRAP/BRIEF.md.
 */
export function useBootstrap(): void {
  const { api, storage, auth, netInfo } = useAdapters();
  const { session, isLoading: authLoading } = useAuth();
  const userId = session?.userId ?? null;
  // From the very first render, before auth resolves, so hooks without a
  // user (the tier catalog) wait as well. Ends below once auth is known.
  const coldStartRef = useRef(false);
  if (!coldStartRef.current) {
    coldStartRef.current = true;
    beginColdStart();
  }
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);
  const queryClient = useQueryClient();
  const startedForRef = useRef<string | null>(null);
  const settleRef = useRef<(() => void) | null>(null);
  if (userId && startedForRef.current !== userId) {
    startedForRef.current = userId;
    settleRef.current = beginBootstrap(userId);
  }
  useEffect(() => {
    if (!userId) {
      if (!authLoading) endColdStart();
      return;
    }
    const settle = settleRef.current ?? beginBootstrap(userId);
    let cancelled = false;
    void (async () => {
      try {
        if (!(await netInfo.isConnected())) return;
        if (cancelled) return;
        const result = await runBootstrap({
          api,
          storage,
          auth,
          userId,
          ownerLibraryOnly: isTrainerEligible,
          queryClient,
        });
        if (!result.ok)
          console.warn("[bootstrap] request failed:", result.error.code);
      } catch (error) {
        console.error("[bootstrap] failed:", error);
      } finally {
        settle();
        endColdStart();
      }
    })();
    return () => {
      cancelled = true;
      settle();
      endColdStart();
    };
    // One run per user; adapters and the query client are stable for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authLoading]);
}
