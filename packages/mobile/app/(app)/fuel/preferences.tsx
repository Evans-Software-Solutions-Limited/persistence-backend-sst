import { useLocalSearchParams } from "expo-router";
import { MealprintPreferencesContainer } from "@/ui/containers/MealprintPreferencesContainer";
import { AdaptiveSuiteRouteGuard } from "@/ui/components/subscription/AdaptiveSuiteRouteGuard";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";

/**
 * Fuel → Mealprint food preferences (spec-26 T-0.6, STORY-001).
 *
 * One route, two modes. `?mode=wizard` is the first-run flow pushed from the Fuel
 * Mealprint card; anything else (including no param) is the editor pushed from
 * the Fuel Targets "Food preferences" row.
 *
 * Entitlement-gated as a Mealprint product surface. Preferences remain stored
 * during a lapse and are restored on resubscription; account export remains the
 * data-rights path.
 *
 * A route rather than a sheet: the form is long, has two text inputs, and a
 * `BottomSheet` fighting the keyboard on a screen where a mis-tap changes an
 * allergen selection is not a trade worth making.
 */
export default function MealprintPreferencesScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const gate = useMealprintGate();
  return (
    <AdaptiveSuiteRouteGuard
      allowed={gate.allowed}
      isResolved={gate.isResolved}
      fallback="/(app)/(tabs)/fuel"
    >
      <MealprintPreferencesContainer
        mode={mode === "wizard" ? "wizard" : "editor"}
      />
    </AdaptiveSuiteRouteGuard>
  );
}
