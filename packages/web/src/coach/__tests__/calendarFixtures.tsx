/* eslint-disable react-refresh/only-export-components -- test helpers */
import type { ReactElement } from "react";
import { vi } from "vitest";
import { CalendarApiContext, type CalendarApi } from "../calendar/api";
import type { CalendarRange, CoachSession, FormDue } from "../calendar/types";
import { CLIENT_ID } from "./helpers";

/** PER-144 fixtures: a fixed week (Tue 24 Nov 2026, 10:00 local). */

export const NOW = new Date(2026, 10, 24, 10, 0);
export const MONDAY = new Date(2026, 10, 23);

export const at = (day: number, h: number, m = 0) =>
  new Date(2026, 10, day, h, m).toISOString();

export function session(over: Partial<CoachSession> = {}): CoachSession {
  const startsAt = over.startsAt ?? at(25, 7);
  const durationMin = over.durationMin ?? 60;
  return {
    id: "s1",
    kind: "in_person",
    startsAt,
    endsAt: new Date(
      new Date(startsAt).getTime() + durationMin * 60_000,
    ).toISOString(),
    durationMin,
    location: "Studio A",
    videoUrl: null,
    workout: { id: "w1", name: "Upper B" },
    seriesId: null,
    notes: null,
    reminderMinutes: 120,
    cancelledAt: null,
    revision: 1,
    createdAt: at(20, 9),
    updatedAt: at(20, 9),
    attendees: [
      {
        clientId: CLIENT_ID,
        relationshipId: "r1",
        name: "Sam Patel",
        avatarUrl: null,
        status: "invited",
        remindedAt: null,
      },
    ],
    ...over,
  };
}

export function formDue(over: Partial<FormDue> = {}): FormDue {
  return {
    requestId: "q1",
    formId: "f1",
    formTitle: "Weekly check-in",
    client: { id: CLIENT_ID, name: "Sam Patel", avatarUrl: null },
    dueAt: at(29, 18),
    status: "sent",
    late: false,
    ...over,
  };
}

export function range(over: Partial<CalendarRange> = {}): CalendarRange {
  return {
    from: MONDAY.toISOString(),
    to: new Date(2026, 10, 30).toISOString(),
    sessions: [session()],
    formsDue: [],
    asOf: NOW.toISOString(),
    ...over,
  };
}

export type FakeCalendarApi = {
  [K in keyof CalendarApi]: ReturnType<typeof vi.fn>;
};

export function fakeCalendarApi(
  over: Partial<FakeCalendarApi> = {},
): FakeCalendarApi {
  return {
    range: vi.fn().mockResolvedValue(range()),
    create: vi.fn().mockResolvedValue({ data: session(), series: [session()] }),
    update: vi.fn().mockResolvedValue({ data: session(), series: [session()] }),
    cancel: vi.fn().mockResolvedValue(undefined),
    workouts: vi.fn().mockResolvedValue([
      { id: "w1", name: "Upper B" },
      { id: "w2", name: "Lower A" },
    ]),
    ...over,
  };
}

export function withCalendar(ui: ReactElement, api: FakeCalendarApi) {
  return (
    <CalendarApiContext.Provider value={api as unknown as CalendarApi}>
      {ui}
    </CalendarApiContext.Provider>
  );
}
