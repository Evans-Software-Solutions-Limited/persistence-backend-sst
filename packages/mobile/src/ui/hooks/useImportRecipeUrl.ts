import { useCallback, useState } from "react";
import type { ImportedRecipe } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

export type ImportRecipeResult =
  | { status: "ok"; recipe: ImportedRecipe }
  | { status: "no-microdata" }
  | { status: "error"; error: ApiError };

/**
 * Import a recipe from a URL (M9) into a manual-create pre-fill. ONLINE-ONLY
 * (external fetch — never queued; the sheet shows an offline notice instead).
 * `422 no_recipe_microdata` → the page had no machine-readable recipe (the
 * deterministic Tier-A scrape found nothing; no AI fallback in M9).
 */
export function useImportRecipeUrl(): {
  mutate: (url: string) => Promise<ImportRecipeResult>;
  isImporting: boolean;
} {
  const { api } = useAdapters();
  const [isImporting, setIsImporting] = useState(false);

  const mutate = useCallback(
    async (url: string): Promise<ImportRecipeResult> => {
      setIsImporting(true);
      try {
        const result = await api.importRecipeUrl(url);
        if (result.ok) return { status: "ok", recipe: result.value };
        if (result.error.status === 422) return { status: "no-microdata" };
        return { status: "error", error: result.error };
      } finally {
        setIsImporting(false);
      }
    },
    [api],
  );

  return { mutate, isImporting };
}
