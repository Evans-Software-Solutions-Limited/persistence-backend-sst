import { RecipeImportContainer } from "@/ui/containers/RecipeImportContainer";

/**
 * `/(app)/fuel/recipe-import` — Import-from-URL (Recipes AI PR3). Opened
 * from <AddRecipeMenuContainer>'s "Import from URL" row. Deterministic Tier-A
 * scrape — not AI-gated. A successful extraction hands off to
 * `fuel/recipe-create` via `useRecipeDraft`.
 *
 * Spec: specs/milestones (Recipes AI PR3 brief) § E. Import-from-URL
 */
export default function RecipeImportScreen() {
  return <RecipeImportContainer />;
}
