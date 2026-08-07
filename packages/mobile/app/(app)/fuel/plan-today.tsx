import { PlanTodayContainer } from "@/ui/containers/PlanTodayContainer";
import { AdaptiveSuiteRouteGuard } from "@/ui/components/subscription/AdaptiveSuiteRouteGuard";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";

/**
 * Fuel → today's Mealprint plan (spec-26 Phase 2, STORY-005 AC 5.3/5.4).
 * Pushed from the Fuel Mealprint card once it has an active plan
 * (`useMealprintEntry`'s `onPress`, when `planProgress` is present) and from
 * the plan sheet's "saved" confirmation.
 *
 * Spec: specs/26-mealprint-meal-planning/design.md § 4 item 5
 */
export default function PlanTodayScreen() {
  const gate = useMealprintGate();
  return (
    <AdaptiveSuiteRouteGuard
      allowed={gate.allowed}
      isResolved={gate.isResolved}
      fallback="/(app)/(tabs)/fuel"
    >
      <PlanTodayContainer />
    </AdaptiveSuiteRouteGuard>
  );
}
