import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Fuel → Recipes library + create flows. Stub route so the Fuel screen's
 * Recipes affordance navigates coherently; the real <RecipesLibrary> (recipes.jsx)
 * lands in M9 PR3.
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Recipes library + flows (PR 3)
 */
export default function RecipesScreen() {
  return (
    <ComingSoon
      icon="book-outline"
      title="Recipes"
      description="Your recipe + meal library arrives next in M9."
      testID="fuel-recipes-stub"
    />
  );
}
