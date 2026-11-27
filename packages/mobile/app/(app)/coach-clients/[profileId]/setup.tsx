import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { SetupChecklistContainer } from "@/ui/containers/coachClients/SetupChecklistContainer";

/**
 * `/coach-clients/[profileId]/setup` — C11g the set-up checklist (PER-125).
 * Coach mode only.
 */
export default function ClientSetupScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <SetupChecklistContainer />;
}
