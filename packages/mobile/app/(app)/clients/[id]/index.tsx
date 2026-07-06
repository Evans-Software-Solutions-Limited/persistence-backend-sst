import { Redirect, useLocalSearchParams } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { ClientDetailContainer } from "@/ui/containers/ClientDetailContainer";

/**
 * `/clients/[id]` — the full single-scroll Client Detail screen (M8 Coach
 * Phase 5). Ports `design-source/screens/client-detail.jsx` 1:1.
 *
 * Coach-mode gate: this route is only meaningful in coach mode, so an athlete
 * who lands here (deep link, or the eligibility watchdog demoting mid-view) is
 * bounced home — mirroring the habits sub-route + tab layout guards.
 */
export default function ClientDetailScreen() {
  const mode = useUserMode((s) => s.mode);
  const { id } = useLocalSearchParams<{ id: string }>();

  if (mode !== "coach" || !id) {
    return <Redirect href="/(app)/(tabs)" />;
  }
  return <ClientDetailContainer />;
}
