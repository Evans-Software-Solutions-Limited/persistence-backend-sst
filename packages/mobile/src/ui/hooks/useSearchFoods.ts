import { useEffect, useRef, useState } from "react";
import type { Food } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useDebouncedValue } from "./useDebouncedValue";
import { useOnlineStatus } from "./useOnlineStatus";

export type SearchFoodsState = {
  results: Food[];
  isSearching: boolean;
  error: ApiError | null;
};

/** Minimum query length before a search fires (matches exercise search). */
const MIN_QUERY = 2;

/**
 * Debounced food search (M9). Online-leaning: hits `GET /foods` after 300ms of
 * stable input and caches the resolved rows into `cached_foods` so a later
 * barcode scan / log can reuse them offline. Short or offline queries resolve
 * to an empty result without a network call. A stale-response guard drops
 * out-of-order results so the latest query always wins.
 */
export function useSearchFoods(query: string): SearchFoodsState {
  const { api, storage } = useAdapters();
  const online = useOnlineStatus();
  const debounced = useDebouncedValue(query.trim(), 300);

  const [results, setResults] = useState<Food[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (debounced.length < MIN_QUERY || !online) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }
    const seq = ++seqRef.current;
    setIsSearching(true);
    setError(null);
    void api
      .searchFoods(debounced)
      .then((result) => {
        if (seq !== seqRef.current) return; // a newer query superseded this one
        if (!result.ok) {
          setError(result.error);
          setResults([]);
          return;
        }
        storage.cacheFoods(result.value);
        setResults(result.value);
      })
      .finally(() => {
        if (seq === seqRef.current) setIsSearching(false);
      });
  }, [debounced, online, api, storage]);

  return { results, isSearching, error };
}
