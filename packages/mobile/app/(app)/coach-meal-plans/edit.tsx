import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { CoachPlanEditorContainer } from "@/ui/containers/coachMealPlans/CoachPlanEditorContainer";

/**
 * `/coach-meal-plans/edit` — the C3 plan editor (PER-135): a new plan, or
 * `?id=` to edit one; `&client=&clientName=` measures it against that
 * client's own target. Coach mode only.
 */
export default function CoachPlanEditScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <CoachPlanEditorContainer />;
}
