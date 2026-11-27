import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { ClientPreviewContainer } from "@/ui/containers/coachClients/ClientPreviewContainer";

/**
 * `/coach-clients/[profileId]/preview` — C11s preview as the client (PER-125).
 * Coach mode only.
 */
export default function ClientPreviewScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <ClientPreviewContainer />;
}
