import { RecipesLibraryContainer } from "@/ui/containers/RecipesLibraryContainer";

/**
 * Fuel → Recipes library (PR1 — no AI). Replaces the M9-era <ComingSoon>
 * stub now that the real library has landed.
 *
 * Spec: specs/milestones (Fuel → Recipes PR1 brief) § Recipes library
 */
export default function RecipesScreen() {
  return <RecipesLibraryContainer />;
}
