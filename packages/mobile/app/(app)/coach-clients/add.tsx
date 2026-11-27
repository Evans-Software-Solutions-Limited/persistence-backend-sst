import { Redirect } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { AddClientWhoContainer } from "@/ui/containers/coachClients/AddClientWhoContainer";

/**
 * `/coach-clients/add` — C11f Add client · 1 Who (PER-125).
 * Coach mode only.
 */
export default function AddClientScreen() {
  const mode = useUserMode((s) => s.mode);
  if (mode !== "coach") return <Redirect href="/(app)/(tabs)" />;
  return <AddClientWhoContainer />;
}
