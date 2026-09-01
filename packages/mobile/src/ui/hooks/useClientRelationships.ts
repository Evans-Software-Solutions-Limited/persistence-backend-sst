import { useCallback, useEffect, useRef, useState } from "react";
import { useAdapters } from "./useAdapters";
import type {
  ClientRelationshipStatus,
  ClientTrainerRelationship,
  RelationshipResponseAction,
} from "@/domain/models/clientRelationship";
import type { ApiError, Result } from "@/shared/errors";
import { useAuth } from "./useAuth";

const relationshipCache = new Map<string, ClientTrainerRelationship[]>();

export type ClientRelationshipsState = {
  data: ClientTrainerRelationship[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  /** Re-fetch from the network. `{ silent: true }` skips the `isRefreshing`
   *  toggle so a focus/background refresh doesn't flash a spinner. */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /**
   * Accept/decline a pending request. On success the row is removed from the
   * local list optimistically (it has left the queried set). Returns the
   * Result so the caller can surface errors.
   *
   * 28-coach-data-sharing-consent: `consent`/`consentVersion` are REQUIRED
   * when `action === "accept"` (the backend 400s `consent_required`
   * otherwise) — the caller must route accept through
   * `<DataSharingConsentSheet>`'s affirmative checkbox first.
   */
  respond: (
    relationshipId: string,
    action: RelationshipResponseAction,
    consent?: boolean,
    consentVersion?: string,
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
  enabled = true,
): ClientRelationshipsState {
  const { api } = useAdapters();
  const { session, isLoading: isAuthLoading } = useAuth();
  const cacheKey = `${session?.userId ?? "signed-out"}:${status ?? "all"}`;
  const activeKeyRef = useRef(enabled ? cacheKey : null);
  activeKeyRef.current = enabled ? cacheKey : null;
  const requestRevisionRef = useRef(0);
  const cached = relationshipCache.get(cacheKey);
  const [data, setData] = useState<ClientTrainerRelationship[]>(cached ?? []);
  const [dataKey, setDataKey] = useState(cacheKey);
  const [isLoading, setIsLoading] = useState(
    isAuthLoading || cached === undefined,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (mode: "initial" | "refresh", silent?: boolean) => {
      if (!enabled) return;
      const requestKey = cacheKey;
      const requestRevision = ++requestRevisionRef.current;
      const showSpinner = mode === "refresh" && !silent;
      if (showSpinner) setIsRefreshing(true);
      const result = await api.getClientRelationships(status);
      if (result.ok) {
        if (
          activeKeyRef.current !== requestKey ||
          requestRevisionRef.current !== requestRevision
        )
          return;
        relationshipCache.set(requestKey, result.value);
        setData(result.value);
        setDataKey(requestKey);
        setError(null);
      } else {
        if (
          activeKeyRef.current !== requestKey ||
          requestRevisionRef.current !== requestRevision
        )
          return;
        setError(result.error);
      }
      if (
        activeKeyRef.current === requestKey &&
        requestRevisionRef.current === requestRevision
      ) {
        setIsLoading(false);
        // The newest request also supersedes any older visible refresh.
        setIsRefreshing(false);
      }
    },
    [api, status, cacheKey, enabled],
  );

  useEffect(() => {
    // Do not issue a signed-out request while the persisted auth session is
    // still bootstrapping. Besides being unnecessary, its late response can
    // overwrite the newly authenticated key's rows.
    if (!enabled) {
      return;
    }
    if (isAuthLoading) return;
    const nextCached = relationshipCache.get(cacheKey);
    setData(nextCached ?? []);
    setDataKey(cacheKey);
    setError(null);
    setIsLoading(nextCached === undefined);
    setIsRefreshing(false);
    setPendingIds(new Set());
    void load("initial");
  }, [cacheKey, enabled, isAuthLoading, load]);

  const refresh = useCallback(
    (opts?: { silent?: boolean }) => load("refresh", opts?.silent),
    [load],
  );

  const respond = useCallback(
    async (
      relationshipId: string,
      action: RelationshipResponseAction,
      consent?: boolean,
      consentVersion?: string,
    ) => {
      setPendingIds((prev) => new Set(prev).add(relationshipId));
      const result = await api.respondToRelationship(
        relationshipId,
        action,
        consent,
        consentVersion,
      );
      if (result.ok) {
        requestRevisionRef.current += 1;
        // The row has left the pending/active query set — drop it locally.
        setData((prev) => {
          const next = prev.filter((r) => r.relationshipId !== relationshipId);
          relationshipCache.set(cacheKey, next);
          return next;
        });
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(relationshipId);
        return next;
      });
      return result;
    },
    [api, cacheKey],
  );

  return {
    // Never expose a row belonging to a previous user/status key during the
    // render before the key-reset effect runs. Cached-active remains visible
    // only when it belongs to this exact key.
    data: !enabled
      ? []
      : dataKey === cacheKey
        ? data
        : (relationshipCache.get(cacheKey) ?? []),
    isLoading: !enabled
      ? false
      : isAuthLoading
        ? true
        : dataKey === cacheKey
          ? isLoading
          : relationshipCache.get(cacheKey) === undefined,
    isRefreshing: enabled ? isRefreshing : false,
    error: enabled ? error : null,
    refresh,
    respond,
    pendingIds,
  };
}
