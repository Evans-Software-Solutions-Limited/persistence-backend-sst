import { useLocalSearchParams } from "expo-router";
import { MealprintPreferencesContainer } from "@/ui/containers/MealprintPreferencesContainer";

/**
 * Fuel → Mealprint food preferences (spec-26 T-0.6, STORY-001).
 *
 * One route, two modes. `?mode=wizard` is the first-run flow pushed from the Fuel
 * Mealprint card; anything else (including no param) is the editor pushed from
 * the Fuel Targets "Food preferences" row.
 *
 * ⚠ **NOT entitlement-gated, and that is deliberate.** Preferences are the user's
 * own data — the Premium+ paywall sits on generation. Gating this route would stop
 * an expired subscriber viewing or correcting the allergen list they entered,
 * which is both hostile and a GDPR access problem. Both endpoints behind it are
 * ungated server-side for the same reason.
 *
 * A route rather than a sheet: the form is long, has two text inputs, and a
 * `BottomSheet` fighting the keyboard on a screen where a mis-tap changes an
 * allergen selection is not a trade worth making.
 */
export default function MealprintPreferencesScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return (
    <MealprintPreferencesContainer
      mode={mode === "wizard" ? "wizard" : "editor"}
    />
  );
}
