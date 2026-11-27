import { createContext, useContext } from "react";
import { coachFetch } from "../api/coachApi";
import type {
  CalendarRange,
  NewSession,
  SessionPatch,
  SessionScope,
  SessionWrite,
  WorkoutOption,
} from "./types";

/**
 * The coach calendar routes (PER-123), for the C4 calendar and the schedule
 * sheet on the web (PER-144). Its own context, like `CoachApiContext`, so
 * tests hand in a fake and the shared API file stays untouched.
 */

/** The workout list is one page of the coach's own workouts. */
export const WORKOUT_LIMIT = 100;

type Data<T> = { data: T };

const send = (method: string, body?: unknown, headers?: HeadersInit) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  ...(headers ? { headers } : {}),
});

const q = encodeURIComponent;

export const calendarApi = {
  range: async (from: string, to: string) =>
    (
      await coachFetch<Data<CalendarRange>>(
        `/trainers/me/calendar?from=${q(from)}&to=${q(to)}`,
      )
    ).data,

  create: (input: NewSession, idempotencyKey: string) =>
    coachFetch<SessionWrite>(
      "/trainers/me/sessions",
      send("POST", input, { "Idempotency-Key": idempotencyKey }),
    ),

  update: (id: string, patch: SessionPatch, scope: SessionScope) =>
    coachFetch<SessionWrite>(
      `/trainers/me/sessions/${q(id)}?scope=${scope}`,
      send("PATCH", patch),
    ),

  cancel: async (id: string, scope: SessionScope) => {
    await coachFetch<null>(
      `/trainers/me/sessions/${q(id)}?scope=${scope}`,
      send("DELETE"),
    );
  },

  workouts: async (): Promise<WorkoutOption[]> =>
    (
      await coachFetch<Data<WorkoutOption[]>>(
        `/workouts?type=mine&limit=${WORKOUT_LIMIT}`,
      )
    ).data.map((w) => ({ id: w.id, name: w.name })),
};

export type CalendarApi = typeof calendarApi;

export const CalendarApiContext = createContext<CalendarApi>(calendarApi);

export function useCalendarApi(): CalendarApi {
  return useContext(CalendarApiContext);
}
