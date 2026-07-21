import { useCallback, useState } from "react";
import type {
  EstimatedRecipeMacros,
  EstimateRecipeInput,
} from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Recipe-import macros fix — AI estimate of a recipe's WHOLE totals (as
 * opposed to `useResolveIngredient`'s single-ingredient resolve), for when the
 * create-recipe form's ingredients aren't (all) linked to foods. ONLINE-ONLY,
 * never queued — same posture as `useResolveIngredient`. Returns `null` on any
 * failure (402/422/429/503/transport); the caller reads `error` for the
 * specific `ApiError` (its `status` distinguishes the daily-limit 429 case).
 */
export function useEstimateRecipe(): {
  mutate: (input: EstimateRecipeInput) => Promise<EstimatedRecipeMacros | null>;
  isEstimating: boolean;
  error: ApiError | null;
} {
  const { api } = useAdapters();
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutate = useCallback(
    async (
      input: EstimateRecipeInput,
    ): Promise<EstimatedRecipeMacros | null> => {
      setIsEstimating(true);
      setError(null);
      try {
        const result = await api.estimateRecipe(input);
        if (result.ok) return result.value;
        setError(result.error);
        return null;
      } finally {
        setIsEstimating(false);
      }
    },
    [api],
  );

  return { mutate, isEstimating, error };
}
