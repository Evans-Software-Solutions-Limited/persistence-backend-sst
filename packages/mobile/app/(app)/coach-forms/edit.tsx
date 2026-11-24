import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { CoachFormEditorContainer } from "@/ui/containers/CoachFormEditorContainer";

/**
 * `/coach-forms/edit` — the C10b form editor (PER-129): a new form, or
 * `?id=` to edit one. Coach mode only.
 */
export default function CoachFormEditScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <CoachFormEditorContainer />;
}
