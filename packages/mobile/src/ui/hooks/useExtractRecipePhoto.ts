import { useCallback, useState } from "react";
import type { ExtractedRecipe } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Recipes AI (PR3) — extract a full recipe from a photo (cookbook page,
 * screenshot, handwritten card) into a manual-create pre-fill. ONLINE-ONLY
 * (mirrors `useAiDraftItems`'s `estimateFromPhoto` call — never queued; the
 * Snap-a-recipe screen shows an offline notice instead).
 *
 * `422 ai_unreadable` → the photo couldn't be read as a recipe.
 * `429 ai_daily_limit` → the caller's daily AI ceiling is spent for the day.
 * Anything else (402 entitlement_denied, 503 ai_unavailable, 413 too-large,
 * transport failures) collapses to the generic `error` branch — the caller
 * is expected to be gated on `useNutritionAiGate` before this ever fires, so
 * a 402 here is defensive, not the primary gate.
 */
export type ExtractRecipeResult =
  | { status: "ok"; recipe: ExtractedRecipe }
  | { status: "unreadable" }
  | { status: "limit" }
  | { status: "error"; error: ApiError };

export function useExtractRecipePhoto(): {
  mutate: (
    imageBase64: string,
    mediaType: "image/jpeg" | "image/png",
  ) => Promise<ExtractRecipeResult>;
  isExtracting: boolean;
} {
  const { api } = useAdapters();
  const [isExtracting, setIsExtracting] = useState(false);

  const mutate = useCallback(
    async (
      imageBase64: string,
      mediaType: "image/jpeg" | "image/png",
    ): Promise<ExtractRecipeResult> => {
      setIsExtracting(true);
      try {
        const result = await api.extractRecipeFromPhoto({
          imageBase64,
          mediaType,
        });
        if (result.ok) return { status: "ok", recipe: result.value };
        if (result.error.status === 422) return { status: "unreadable" };
        if (result.error.status === 429) return { status: "limit" };
        return { status: "error", error: result.error };
      } finally {
        setIsExtracting(false);
      }
    },
    [api],
  );

  return { mutate, isExtracting };
}
