import { RecipeSnapContainer } from "@/ui/containers/RecipeSnapContainer";

/**
 * `/(app)/fuel/recipe-snap` — Snap-a-recipe-photo (Recipes AI PR3). AI-gated;
 * opened from <AddRecipeMenuContainer>'s "Snap a recipe photo" row. A
 * successful extraction hands off to `fuel/recipe-create` via
 * `useRecipeDraft`.
 *
 * Spec: specs/milestones (Recipes AI PR3 brief) § F. Snap-a-recipe-photo
 */
export default function RecipeSnapScreen() {
  return <RecipeSnapContainer />;
}
