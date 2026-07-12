import { useCallback, useState } from "react";
import type { Food } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Recipes AI (PR3) — resolve a free-text ingredient name to a Food via AI
 * when the manual food search comes up empty (the create-recipe form's
 * per-row "Create '{name}' with AI" affordance). ONLINE-ONLY, never queued —
 * same posture as `useExtractRecipePhoto`. Returns `null` on any failure
 * (402/422/429/503/transport); the caller reads `error` for the specific
 * `ApiError` (its `status` distinguishes the daily-limit 429 case, mirroring
 * `useImportRecipeUrl`/`useExtractRecipePhoto`'s status-based branching).
 */
export function useResolveIngredient(): {
  mutate: (name: string) => Promise<Food | null>;
  isResolving: boolean;
  error: ApiError | null;
} {
  const { api } = useAdapters();
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutate = useCallback(
    async (name: string): Promise<Food | null> => {
      setIsResolving(true);
      setError(null);
      try {
        const result = await api.resolveIngredient({ name });
        if (result.ok) return result.value;
        setError(result.error);
        return null;
      } finally {
        setIsResolving(false);
      }
    },
    [api],
  );

  return { mutate, isResolving, error };
}
