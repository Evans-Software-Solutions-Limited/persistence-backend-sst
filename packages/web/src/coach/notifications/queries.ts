import { useQuery } from "@tanstack/react-query";
import { COACH_NETWORK_MODE } from "../hooks/coachQueries";
import { useNotificationsApi } from "./api";

/**
 * Queries for Today, Notifications and settings (PER-131). Keys sit under
 * `["coach", …]`, so signing out (which drops `coachKeys.all`) drops them.
 */
export const notificationKeys = {
  feed: ["coach", "notifications", "feed"] as const,
  today: ["coach", "notifications", "today"] as const,
  settings: ["coach", "notifications", "settings"] as const,
};

/** Refresh Today and the feed every minute while a coach page is open. */
const POLL_MS = 60_000;

export function useFeed(enabled = true) {
  const api = useNotificationsApi();
  return useQuery({
    queryKey: notificationKeys.feed,
    queryFn: () => api.feed(),
    networkMode: COACH_NETWORK_MODE,
    refetchInterval: POLL_MS,
    enabled,
  });
}

export function useToday(enabled = true) {
  const api = useNotificationsApi();
  return useQuery({
    queryKey: notificationKeys.today,
    queryFn: () => api.today(),
    networkMode: COACH_NETWORK_MODE,
    refetchInterval: POLL_MS,
    enabled,
  });
}

export function useNotificationSettings() {
  const api = useNotificationsApi();
  return useQuery({
    queryKey: notificationKeys.settings,
    queryFn: () => api.settings(),
    networkMode: COACH_NETWORK_MODE,
  });
}
