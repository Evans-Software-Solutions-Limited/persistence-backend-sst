import { Redirect, useLocalSearchParams } from "expo-router";

import { useUserMode } from "@/state/user-mode";
import { ClientPhotoCompareContainer } from "@/ui/containers/coachPhotos/ClientPhotoCompareContainer";

/**
 * `/clients/[id]/photos-compare` — compare a client's progress photos
 * (PER-138, C3.4c). Coach mode only, like the other client routes.
 */
export default function ClientPhotoCompareScreen() {
  const mode = useUserMode((s) => s.mode);
  const { id } = useLocalSearchParams<{ id: string }>();
  if (mode !== "coach" || !id) {
    return <Redirect href="/(app)/(tabs)" />;
  }
  return <ClientPhotoCompareContainer />;
}
