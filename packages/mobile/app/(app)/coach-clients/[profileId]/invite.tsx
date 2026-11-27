import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { InviteStepContainer } from "@/ui/containers/coachClients/InviteStepContainer";

/**
 * `/coach-clients/[profileId]/invite` — C11h the invite (PER-125).
 * Coach mode only.
 */
export default function ClientInviteScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <InviteStepContainer />;
}
