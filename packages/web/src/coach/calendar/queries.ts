import { useQuery, type QueryClient } from "@tanstack/react-query";
import { COACH_NETWORK_MODE } from "../hooks/coachQueries";
import { useCalendarApi } from "./api";

/**
 * Calendar queries (PER-144). Keys sit under `["coach", …]`, so signing out
 * (which drops `coachKeys.all`) drops them too.
 */
export const calendarKeys = {
  all: ["coach", "calendar"] as const,
  range: (from: string, to: string) => ["coach", "calendar", from, to] as const,
  workouts: ["coach", "calendar-workouts"] as const,
};

/** Today's schedule (PER-131's Today page) reads the same sessions. */
export const TODAY_KEY = ["coach", "notifications", "today"] as const;

export function useCalendarRange(from: string, to: string) {
  const api = useCalendarApi();
  return useQuery({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => api.range(from, to),
    networkMode: COACH_NETWORK_MODE,
  });
}

export function useWorkoutOptions() {
  const api = useCalendarApi();
  return useQuery({
    queryKey: calendarKeys.workouts,
    queryFn: () => api.workouts(),
    networkMode: COACH_NETWORK_MODE,
    staleTime: 5 * 60_000,
  });
}

/** After a session changes: reload every calendar week and Today. */
export async function refreshSchedule(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
    queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  ]);
}
