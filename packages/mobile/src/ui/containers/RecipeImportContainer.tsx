import { useCallback, useState } from "react";
import { router } from "expo-router";
import { useRecipeDraft } from "@/state/recipe-draft";
import { useImportRecipeUrl } from "@/ui/hooks/useImportRecipeUrl";
import {
  RecipeImportPresenter,
  type ImportStage,
} from "@/ui/presenters/RecipeImportPresenter";

/**
 * <RecipeImportContainer> — Import-from-URL (recipes.jsx `ImportFromURL`,
 * Recipes AI PR3 § E). DETERMINISTIC Tier-A scrape (`useImportRecipeUrl`) —
 * NOT AI-gated, online-only, never queued. A successful extraction seeds
 * `useRecipeDraft` and hands off to the create-recipe form
 * (`router.replace`) for review/edit; a 422 (no machine-readable recipe)
 * offers a "Create manually" escape hatch; any other failure offers retry.
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § E. Import-from-URL
 */
export function RecipeImportContainer() {
  const importRecipeUrl = useImportRecipeUrl();
  const setSeed = useRecipeDraft((s) => s.setSeed);

  const [stage, setStage] = useState<ImportStage>("input");
  const [url, setUrl] = useState("");
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedIngredients, setPastedIngredients] = useState("");
  const [pastedInstructions, setPastedInstructions] = useState("");

  // Carry attribution into both recovery paths, without keeping an invalid URL.
  const sourceUrl = (() => {
    try {
      const parsed = new URL(url.trim());
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  })();
  const onPasteRecipe = useCallback(() => setStage("paste"), []);
  const onReviewPasted = useCallback(() => {
    const ingredients = pastedIngredients
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!pastedTitle.trim() || ingredients.length === 0) return;
    setSeed({
      title: pastedTitle.trim(),
      servings: null,
      ingredients: ingredients.map((name) => ({
        name,
        quantity: null,
        unit: null,
      })),
      instructions: pastedInstructions.trim() || null,
      source: "manual",
      sourceUrl,
    });
    router.replace("/(app)/fuel/recipe-create" as never);
  }, [pastedTitle, pastedIngredients, pastedInstructions, sourceUrl, setSeed]);

  const onBack = useCallback(() => router.back(), []);

  const onCreateManually = useCallback(() => {
    setSeed({
      title: "",
      servings: null,
      instructions: null,
      ingredients: [],
      source: "manual",
      sourceUrl,
    });
    router.replace("/(app)/fuel/recipe-create" as never);
  }, [sourceUrl, setSeed]);

  const onRetry = useCallback(() => setStage("input"), []);

  const onImport = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStage("importing");
    const result = await importRecipeUrl.mutate(trimmed);
    if (result.status === "ok") {
      const recipe = result.recipe;
      setSeed({
        title: recipe.name,
        servings: recipe.servings,
        instructions: recipe.instructions,
        ingredients: recipe.ingredients.map((line) => ({
          name: line,
          quantity: null,
          unit: null,
        })),
        source: "import",
        nutrition: recipe.nutrition,
        sourceUrl: recipe.sourceUrl,
      });
      router.replace("/(app)/fuel/recipe-create" as never);
      return;
    }
    if (result.status === "no-microdata") {
      setStage("no-microdata");
      return;
    }
    setStage("error");
  }, [url, importRecipeUrl, setSeed]);

  return (
    <RecipeImportPresenter
      stage={stage}
      url={url}
      onUrlChange={setUrl}
      onImport={() => void onImport()}
      onCreateManually={onCreateManually}
      onRetry={onRetry}
      onBack={onBack}
      onPasteRecipe={onPasteRecipe}
      pastedTitle={pastedTitle}
      pastedIngredients={pastedIngredients}
      pastedInstructions={pastedInstructions}
      onPastedTitleChange={setPastedTitle}
      onPastedIngredientsChange={setPastedIngredients}
      onPastedInstructionsChange={setPastedInstructions}
      onReviewPasted={onReviewPasted}
    />
  );
}
