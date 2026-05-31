import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Fuel tab — nutrition. Placeholder from the moment the nav restructures so
 * the IA is stable through M9 development.
 *
 * Spec: specs/14-navigation/design.md § Route migration table (fuel.tsx)
 *       specs/14-navigation/requirements.md STORY-006
 *
 * `13-nutrition-tracking` replaces this `<ComingSoon/>` with the real Fuel
 * frontend when it ships (this spec gets a "Revised YYYY-MM-DD" append at
 * that point — AC 6.2). Not rendered in coach mode (AC 6.3).
 */
export default function FuelTab() {
  return (
    <ComingSoon
      icon="restaurant-outline"
      title="Fuel"
      description="Nutrition tracking arrives in milestone M9 (13-nutrition-tracking)."
      testID="fuel-tab"
    />
  );
}
