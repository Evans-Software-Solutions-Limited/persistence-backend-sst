import { RecipeCreateContainer } from "@/ui/containers/RecipeCreateContainer";

/**
 * `/(app)/fuel/recipe-create` — the manual create-recipe form (Recipes AI
 * PR3). The hub every creation path lands on: opened directly from
 * <AddRecipeMenuContainer>'s "Create a recipe" row (blank), or via
 * `router.replace` from Import-from-URL / Snap-a-recipe-photo, which
 * pre-fill it through `useRecipeDraft`.
 *
 * Spec: specs/milestones (Recipes AI PR3 brief) § D. Create-recipe form
 */
export default function RecipeCreateScreen() {
  return <RecipeCreateContainer />;
}
