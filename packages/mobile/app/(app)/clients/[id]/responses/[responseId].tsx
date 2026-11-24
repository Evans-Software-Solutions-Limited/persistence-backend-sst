import { Redirect, useLocalSearchParams } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { FormResponseContainer } from "@/ui/containers/FormResponseContainer";

/**
 * `/clients/[id]/responses/[responseId]` — review one check-in (PER-129,
 * C3.3 Review). Coach mode only, like the other client routes.
 */
export default function ClientResponseScreen() {
  const mode = useUserMode((s) => s.mode);
  const { id, responseId } = useLocalSearchParams<{
    id: string;
    responseId: string;
  }>();
  if (mode !== "coach" || !id || !responseId) {
    return <Redirect href="/(app)/(tabs)" />;
  }
  return <FormResponseContainer />;
}
