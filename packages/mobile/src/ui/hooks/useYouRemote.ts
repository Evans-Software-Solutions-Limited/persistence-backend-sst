import { useMemo } from "react";
import {
  createYouRemoteSource,
  youRemoteUnavailable,
  type YouRemoteSource,
} from "@/application/queries/youRemote";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * The BE-H1 seam (PER-113) for the signed-in athlete: server reads for the
 * ranges the phone's training log doesn't hold, cached by period.
 */
export function useYouRemote(): YouRemoteSource {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  return useMemo(
    () =>
      userId
        ? createYouRemoteSource(api, storage, userId)
        : youRemoteUnavailable,
    [api, storage, userId],
  );
}
