import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { InvitedClientContainer } from "@/ui/containers/coachClients/InvitedClientContainer";

/**
 * `/coach-clients/[profileId]` — C11i the invited client (PER-125).
 * Coach mode only.
 */
export default function InvitedClientScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <InvitedClientContainer />;
}
