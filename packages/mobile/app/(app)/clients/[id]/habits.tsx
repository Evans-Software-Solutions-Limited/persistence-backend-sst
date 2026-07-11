import { Redirect, useLocalSearchParams } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { HabitSetupContainer } from "@/ui/containers/HabitSetupContainer";

/**
 * `/clients/[id]/habits` — a coach manages a client's habits (18-habit-setup
 * § 3.2, coach view). The SAME setup screen rendered for a `:clientId`, wiring
 * the trainer routes so writes land on the client's behalf with attribution.
 *
 * Coach-mode gate: this route is only meaningful in coach mode, so an athlete
 * who lands here (deep link, or the eligibility watchdog demoting mid-view) is
 * redirected home — mirroring the tab layout's stranded-route guard.
 */
export default function ClientHabitsScreen() {
  const mode = useUserMode((s) => s.mode);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  if (mode !== "coach" || !id) {
    return <Redirect href="/(app)/(tabs)" />;
  }
  return <HabitSetupContainer clientId={id} clientName={name} />;
}
