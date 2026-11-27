import { useCallback } from "react";
import { Alert, Linking } from "react-native";
import type { AthleteResource } from "@/domain/models/coachResources";
import { fileLinkUsable } from "@/domain/services/coachResources.service";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import type { CachedResourceState } from "@/ui/hooks/useCachedResource";
import { useMarkResourceOpened } from "@/ui/hooks/useCoachResources";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";

/**
 * The athlete opens a resource from the Coach tab. A link opens straight
 * away. A file's link from the API lasts 15 minutes: an old one is fetched
 * again first, which needs a connection (nothing is downloaded to the phone,
 * no expo-file-system). Opening stamps it as opened (queued, so offline
 * opens of a link still count).
 */
export function useOpenResource(
  resources: Pick<CachedResourceState<AthleteResource[]>, "data" | "refresh">,
) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const online = useOnlineStatus();
  const markOpened = useMarkResourceOpened();
  const { data, refresh } = resources;

  return useCallback(
    async (assignmentId: string) => {
      let row = data?.find((r) => r.assignmentId === assignmentId);
      if (!row) return;
      if (!fileLinkUsable(row, new Date())) {
        if (!online) {
          Alert.alert(
            "You're offline",
            "Opening a file needs a connection. Try again when you're back online.",
          );
          return;
        }
        await refresh({ silent: true });
        row = userId
          ? storage
              .getCachedMyResources(userId)
              ?.find((r) => r.assignmentId === assignmentId)
          : undefined;
        if (!row || !fileLinkUsable(row, new Date())) {
          Alert.alert(
            "Couldn't open it",
            "This file isn't available right now. Pull to refresh and try again.",
          );
          return;
        }
      }
      try {
        await Linking.openURL(row.url!);
      } catch {
        Alert.alert("Couldn't open it", "Try again in a moment.");
        return;
      }
      await markOpened(assignmentId);
    },
    [data, refresh, online, storage, userId, markOpened],
  );
}
