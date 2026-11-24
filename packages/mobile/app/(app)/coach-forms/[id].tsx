import { Redirect, useLocalSearchParams } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { CoachFormContainer } from "@/ui/containers/CoachFormContainer";

/**
 * `/coach-forms/[id]` — a form's page and the C10h send sheet (PER-129).
 * Coach mode only: an athlete landing here is sent home, like the other
 * coach routes.
 */
export default function CoachFormScreen() {
  const mode = useUserMode((s) => s.mode);
  const { id } = useLocalSearchParams<{ id: string }>();
  if (mode !== "coach" || !id) return <Redirect href="/(app)/(tabs)" />;
  return <CoachFormContainer />;
}
