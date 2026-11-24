import { NewPlanContainer } from "@/ui/containers/plans/NewPlanContainer";

/**
 * `/(app)/fuel/plan-new?from=empty|day|plan` — New plan → Build → Saved
 * (PER-133, canvas N28–N33).
 */
export default function PlanNewScreen() {
  return <NewPlanContainer />;
}
