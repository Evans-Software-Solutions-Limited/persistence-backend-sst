import { useCallback, useState } from "react";
import type { CreateFoodInput, Food } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Create a custom food (M9) — the manual-add path off a barcode miss / no
 * search hit. ONLINE-leaning (not queued): the entry that follows references
 * the new food's id, which only exists once the server assigns it, so this
 * resolves online then caches the row for offline reuse. Returns the created
 * Food, or null on failure (the caller reads `error`).
 */
export function useCreateFood(): {
  mutate: (input: CreateFoodInput) => Promise<Food | null>;
  isSaving: boolean;
  error: ApiError | null;
} {
  const { api, storage } = useAdapters();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutate = useCallback(
    async (input: CreateFoodInput) => {
      setIsSaving(true);
      setError(null);
      try {
        const result = await api.createFood(input);
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        storage.cacheFoods([result.value]);
        return result.value;
      } finally {
        setIsSaving(false);
      }
    },
    [api, storage],
  );

  return { mutate, isSaving, error };
}
