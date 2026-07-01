import { FuelTargetsContainer } from "@/ui/containers/FuelTargetsContainer";

/**
 * Fuel → Targets editor (TDEE calculator). Replaces the M9-era stub with the
 * real screen (M9 PR3).
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Fuel Targets screen (PR 3)
 *       specs/13-nutrition-tracking/requirements.md STORY-004
 */
export default function FuelTargetsScreen() {
  return <FuelTargetsContainer />;
}
