import { MealprintContainer } from "@/ui/containers/mealprint/MealprintContainer";

/**
 * `/(app)/fuel/mealprint?mode=meal|day&slot=&userMealId=` — Mealprint
 * (PER-134, canvas N15–N27): One meal or Whole day on one full-screen page,
 * or the locked page (N26) without Premium+.
 */
export default function MealprintScreen() {
  return <MealprintContainer />;
}
