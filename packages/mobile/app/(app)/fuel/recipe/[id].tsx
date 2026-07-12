import { useLocalSearchParams } from "expo-router";
import { RecipeDetailContainer } from "@/ui/containers/RecipeDetailContainer";

/**
 * `/(app)/fuel/recipe/[id]` — read-only recipe detail (PR1 — no AI).
 *
 * Spec: specs/milestones (Fuel → Recipes PR1 brief) § Recipe Detail
 */
export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecipeDetailContainer id={id} />;
}
