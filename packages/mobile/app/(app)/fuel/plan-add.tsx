import { PlanAddFoodContainer } from "@/ui/containers/plans/PlanAddFoodContainer";

/**
 * `/(app)/fuel/plan-add?meal=<planMealId>` — Add to a meal of the plan being
 * built (PER-133, canvas N30). Never logs.
 */
export default function PlanAddScreen() {
  return <PlanAddFoodContainer />;
}
