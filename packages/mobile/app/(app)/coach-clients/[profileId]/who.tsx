import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { AddClientWhoContainer } from "@/ui/containers/coachClients/AddClientWhoContainer";

/**
 * `/coach-clients/[profileId]/who` — C11f on an existing profile (PER-125).
 * Coach mode only.
 */
export default function ClientWhoScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <AddClientWhoContainer />;
}
