import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "./useAdapters";
import type { BodyTrendPoint } from "@/domain/models/progress";
import type { ApiError } from "@/shared/errors";

export type ClientBodyTrendState = {
  /** Oldest-first series, or null before the first fetch resolves. */
  data: BodyTrendPoint[] | null;
  isLoading: boolean;
  error: ApiError | null;
  /** Re-fetch from the network. */
  refresh: () => Promise<void>;
};

/**
 * Coach-side fetch of one client's body-measurement trend
 * (`GET /clients/:clientId/body-trend`, 10-trainer-features Client Detail).
 *
 * Network-only (no SQLite cache) — same call as `useClientRelationships`: a
 * coach browses many clients, so per-client cache slots buy little, and the
 * screen wants fresh data right after logging a weight for the client.
 */
export function useGetClientBodyTrend(
  clientId: string | undefined,
  windowDays = 30,
): ClientBodyTrendState {
  const { api } = useAdapters();
  const [data, setData] = useState<BodyTrendPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!clientId) {
      // No client to fetch — settle (not "loading forever") and drop any
      // previous client's series so a valid→undefined id transition can't
      // strand stale data behind a permanent spinner.
      setData(null);
      setIsLoading(false);
      return;
    }
    const result = await api.getClientBodyTrend(clientId, `${windowDays}d`);
    if (result.ok) {
      setData(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [api, clientId, windowDays]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  return { data, isLoading, error, refresh: load };
}
