import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { SetupSectionContainer } from "@/ui/containers/coachClients/SetupSectionContainer";

/**
 * `/coach-clients/[profileId]/section?section=` — C11l–r (PER-125).
 * Coach mode only.
 */
export default function ClientSetupSectionScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <SetupSectionContainer />;
}
