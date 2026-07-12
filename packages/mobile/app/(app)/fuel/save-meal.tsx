import { SaveMealContainer } from "@/ui/containers/SaveMealContainer";

/**
 * `/(app)/fuel/save-meal` — quick-save a meal from already-logged items
 * (PR1 — no AI). Opened directly from the Recipes library's "+" header
 * action; the 4-option add menu (create-recipe / import-URL / snap-photo)
 * is PR2/PR3.
 *
 * Spec: specs/milestones (Fuel → Recipes PR1 brief) § Save a meal
 */
export default function SaveMealScreen() {
  return <SaveMealContainer />;
}
