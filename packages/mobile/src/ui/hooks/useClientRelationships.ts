import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "./useAdapters";
import type {
  ClientRelationshipStatus,
  ClientTrainerRelationship,
  RelationshipResponseAction,
} from "@/domain/models/clientRelationship";
import type { ApiError, Result } from "@/shared/errors";

export type ClientRelationshipsState = {
  data: ClientTrainerRelationship[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  /** Re-fetch from the network. */
  refresh: () => Promise<void>;
  /**
   * Accept/decline a pending request. On success the row is removed from the
   * local list optimistically (it has left the queried set). Returns the
   * Result so the caller can surface errors.
   */
  respond: (
    relationshipId: string,
    action: RelationshipResponseAction,
  ) => Promise<Result<unknown, ApiError>>;
  /** relationshipIds with an in-flight respond() call (for per-row busy UI). */
  pendingIds: ReadonlySet<string>;
};

/**
 * Fetch + mutate the current user's trainer relationships as a client
 * (10-trainer-features). Network-only (no SQLite cache) — the relationship
 * set is small and the Requests/You surfaces want fresh state. `status`
 * scopes the query: "pending" for the Requests screen, "active" for the
 * You-page trainer section.
 */
export function useClientRelationships(
  status?: ClientRelationshipStatus,
): ClientRelationshipsState {
  const { api } = useAdapters();
  const [data, setData] = useState<ClientTrainerRelationship[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "refresh") setIsRefreshing(true);
      const result = await api.getClientRelationships(status);
      if (result.ok) {
        setData(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [api, status],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const refresh = useCallback(() => load("refresh"), [load]);

  const respond = useCallback(
    async (relationshipId: string, action: RelationshipResponseAction) => {
      setPendingIds((prev) => new Set(prev).add(relationshipId));
      const result = await api.respondToRelationship(relationshipId, action);
      if (result.ok) {
        // The row has left the pending/active query set — drop it locally.
        setData((prev) =>
          prev.filter((r) => r.relationshipId !== relationshipId),
        );
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(relationshipId);
        return next;
      });
      return result;
    },
    [api],
  );

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh,
    respond,
    pendingIds,
  };
}
