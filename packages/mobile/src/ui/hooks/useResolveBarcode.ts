import { useCallback, useState } from "react";
import type { ResolveBarcodeResult } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useOnlineStatus } from "./useOnlineStatus";

export type ResolveBarcode = {
  resolve: (code: string) => Promise<ResolveBarcodeResult>;
  isResolving: boolean;
};

/**
 * Barcode → Food resolution for the scan sheet (M9). Cache-first (offline
 * barcode fallback, design.md § Offline behaviour):
 *   1. local `cached_foods` hit → `found` (macros don't change; no round-trip);
 *   2. miss + offline → `cache-miss-offline` ("connect to fetch from database");
 *   3. miss + online → `POST /nutrition/barcode/resolve`:
 *        ok → cache + `found`; 404 `barcode_not_found` → `not-found`
 *        (the user adds the food manually); 503/other → `service-unavailable`.
 */
export function useResolveBarcode(): ResolveBarcode {
  const { api, storage } = useAdapters();
  const online = useOnlineStatus();
  const [isResolving, setIsResolving] = useState(false);

  const resolve = useCallback(
    async (code: string): Promise<ResolveBarcodeResult> => {
      const cached = storage.getCachedFoodByBarcode(code);
      if (cached) return { status: "found", food: cached };
      if (!online) return { status: "cache-miss-offline" };

      setIsResolving(true);
      try {
        const result = await api.resolveBarcode(code);
        if (result.ok) {
          storage.cacheFoods([result.value]);
          return { status: "found", food: result.value };
        }
        if (result.error.code === "not_found") return { status: "not-found" };
        return { status: "service-unavailable" };
      } finally {
        setIsResolving(false);
      }
    },
    [api, storage, online],
  );

  return { resolve, isResolving };
}
