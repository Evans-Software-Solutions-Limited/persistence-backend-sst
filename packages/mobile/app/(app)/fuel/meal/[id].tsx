import { useLocalSearchParams } from "expo-router";
import { MealDetailContainer } from "@/ui/containers/MealDetailContainer";

/**
 * `/(app)/fuel/meal/[id]` — read-only saved-meal detail (PR1 — no AI).
 *
 * Spec: specs/milestones (Fuel → Recipes PR1 brief) § Meal Detail
 */
export default function MealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MealDetailContainer id={id} />;
}
