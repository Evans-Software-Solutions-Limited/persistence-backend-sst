import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Fuel → Targets editor (TDEE calculator). Stub route so the Fuel screen's
 * Target/EDIT affordances navigate coherently; the real <FuelTargetsContainer>
 * (fuel-targets.jsx, Conflict C2) lands in M9 PR3.
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Fuel Targets screen (PR 3)
 */
export default function FuelTargetsScreen() {
  return (
    <ComingSoon
      icon="options-outline"
      title="Targets"
      description="The TDEE-based targets editor arrives next in M9."
      testID="fuel-targets-stub"
    />
  );
}
