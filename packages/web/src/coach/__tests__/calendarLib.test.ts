import { describe, expect, it, vi } from "vitest";
import { calendarApi } from "../calendar/api";
import {
  addDays,
  dayHead,
  dayKey,
  groupFormsDue,
  hourRange,
  isoWeek,
  lengthLabel,
  longDay,
  parseDay,
  placeDay,
  reminderLabel,
  sessionSubtitle,
  sessionTitle,
  weekStart,
  weekTitle,
} from "../calendar/lib";
import {
  blankValues,
  isEmptyPatch,
  nextHour,
  scheduleResolver,
  scheduleRules,
  sessionValues,
  startsAtOf,
  toNewSession,
  toPatch,
  type ScheduleValues,
} from "../calendar/scheduleForm";
import { writeError } from "../calendar/writeError";
import { CLIENT_ID, apiError } from "./helpers";
import { MONDAY, NOW, at, formDue, session } from "./calendarFixtures";

vi.mock("../api/coachAuth", async (orig) => ({
  ...(await orig<typeof import("../api/coachAuth")>()),
  getAccessToken: vi.fn().mockResolvedValue("tok"),
}));

describe("calendar dates (C4a)", () => {
  it("starts weeks on Monday and titles them", () => {
    expect(dayKey(weekStart(NOW))).toBe("2026-11-23");
    expect(dayKey(weekStart(new Date(2026, 10, 29, 23)))).toBe("2026-11-23");
    expect(isoWeek(MONDAY)).toBe(48);
    expect(weekTitle(MONDAY)).toBe("Week 48 · 23 Nov – 29 Nov");
    expect(dayHead(NOW)).toBe("Tue 24");
    expect(longDay(addDays(NOW, 2))).toBe("Thu 26 Nov");
  });

  it("parses only real days", () => {
    expect(parseDay("2026-11-24")?.getDate()).toBe(24);
    expect(parseDay("2026-02-31")).toBeNull();
    expect(parseDay("nope")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it("words lengths and reminders", () => {
    expect(lengthLabel(45)).toBe("45 min");
    expect(lengthLabel(60)).toBe("1 h");
    expect(lengthLabel(90)).toBe("1 h 30 min");
    expect(reminderLabel(120)).toBe("2 h");
    expect(reminderLabel(1440)).toBe("1 day");
    expect(reminderLabel(2880)).toBe("2 days");
  });
});

describe("session wording", () => {
  it("names one client, a group, your training or the kind", () => {
    expect(sessionTitle(session())).toBe("Sam Patel");
    expect(sessionSubtitle(session())).toBe("In person · Studio A");
    const two = session({
      attendees: [
        ...session().attendees,
        { ...session().attendees[0]!, clientId: "c2", relationshipId: "r2" },
      ],
    });
    expect(sessionTitle(two)).toBe("Group · 2 booked");
    const own = session({ kind: "own_training", attendees: [] });
    expect(sessionTitle(own)).toBe("Your training");
    expect(sessionSubtitle(own)).toBe("Upper B");
    expect(sessionSubtitle({ ...own, workout: null })).toBe("Training");
    expect(sessionTitle(session({ kind: "video", attendees: [] }))).toBe(
      "Video call",
    );
  });

  it("says declined and cancelled", () => {
    const declined = session({
      kind: "video",
      attendees: [{ ...session().attendees[0]!, status: "declined" }],
    });
    expect(sessionSubtitle(declined)).toBe("Video call · declined");
    expect(sessionSubtitle(session({ cancelledAt: at(24, 9) }))).toBe(
      "Cancelled · in person",
    );
  });
});

describe("forms due and layout", () => {
  it("groups forms due per day and form, earliest first", () => {
    const groups = groupFormsDue([
      formDue({ requestId: "a", dueAt: at(29, 18) }),
      formDue({ requestId: "b", dueAt: at(29, 9), late: true }),
      formDue({
        requestId: "c",
        formId: "f2",
        formTitle: "Daily",
        dueAt: at(25, 8),
      }),
    ]);
    expect(groups.map((g) => [g.formTitle, g.items.length, g.late])).toEqual([
      ["Daily", 1, 0],
      ["Weekly check-in", 2, 1],
    ]);
    expect(groups[1]!.dueAt.getHours()).toBe(9);
  });

  it("widens the hours to fit and lays overlaps side by side", () => {
    const d = (h: number, m = 0) => new Date(2026, 10, 24, h, m);
    expect(hourRange([])).toEqual({ first: 6, last: 21 });
    expect(hourRange([{ start: d(5), end: d(22, 30) }])).toEqual({
      first: 5,
      last: 23,
    });
    expect(
      hourRange([{ start: d(23), end: new Date(2026, 10, 25, 1) }]).last,
    ).toBe(24);
    const placed = placeDay(
      [
        { item: "a", start: d(7), end: d(8) },
        { item: "b", start: d(7, 30), end: d(8, 30) },
        { item: "c", start: d(9), end: d(9, 5) },
      ],
      6,
    );
    expect(
      placed.map((p) => [p.item, p.top, p.height, p.lane, p.lanes]),
    ).toEqual([
      ["a", 60, 60, 0, 2],
      ["b", 90, 60, 1, 2],
      ["c", 180, 20, 0, 1],
    ]);
  });
});

describe("schedule form (C4c)", () => {
  const base = (over: Partial<ScheduleValues> = {}): ScheduleValues => ({
    ...blankValues({ clientIds: [CLIENT_ID], start: new Date(2099, 0, 5, 7) }),
    ...over,
  });

  it("starts at the next hour with a 2 h reminder", () => {
    expect(nextHour(new Date(2026, 10, 24, 9, 40)).getHours()).toBe(10);
    const v = base();
    expect(v).toMatchObject({
      durationMin: 60,
      reminderMinutes: 120,
      time: "07:00",
    });
    expect(
      blankValues({ kind: "own_training", start: NOW }).reminderMinutes,
    ).toBe(0);
    expect(startsAtOf({ date: "x", time: "07:00" })).toBeNull();
  });

  it("checks clients and past times", () => {
    expect(scheduleRules(base({ clientIds: [] }), { isNew: true })).toEqual({
      clientIds: "Pick who this session is with.",
    });
    expect(
      scheduleRules(base({ kind: "own_training" }), { isNew: true }).clientIds,
    ).toMatch(/can't have clients/);
    expect(
      scheduleRules(base({ date: "2020-01-01" }), { isNew: true }).time,
    ).toMatch(/hasn't passed/);
    expect(
      scheduleRules(base({ date: "2020-01-01" }), { isNew: false }),
    ).toEqual({});
  });

  it("validates through the resolver with the form's copy", async () => {
    const resolve = scheduleResolver(true);
    const bad = await resolve(
      base({ videoUrl: "http://x", kind: "video", time: "" }),
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(bad.errors.videoUrl?.message).toBe("Use an https:// link.");
    expect(bad.errors.time?.message).toBe("Pick a time.");
    const good = await resolve(
      base({ videoUrl: " Https://meet.example/x " }),
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(good.errors).toEqual({});
  });

  it("builds the create body for each kind", () => {
    expect(
      toNewSession(base({ location: " Studio A ", repeatWeeks: 8 })),
    ).toEqual({
      kind: "in_person",
      startsAt: new Date(2099, 0, 5, 7).toISOString(),
      durationMin: 60,
      location: "Studio A",
      videoUrl: null,
      workoutId: null,
      notes: null,
      reminderMinutes: 120,
      clientIds: [CLIENT_ID],
      repeat: { frequency: "weekly", count: 8 },
    });
    const video = toNewSession(
      base({ kind: "video", location: "ignored", videoUrl: "Https://m.x/1" }),
    );
    expect(video).toMatchObject({ location: null, videoUrl: "https://m.x/1" });
    expect(video.repeat).toBeUndefined();
    const own = toNewSession(
      base({ kind: "own_training", workoutId: "w1", reminderMinutes: 60 }),
    );
    expect(own).toMatchObject({
      clientIds: [],
      reminderMinutes: null,
      workoutId: "w1",
    });
    expect(
      toNewSession(base({ reminderMinutes: 0 })).reminderMinutes,
    ).toBeNull();
  });

  it("patches only what changed, with the revision", () => {
    const s = session({ revision: 4 });
    const same = toPatch(s, sessionValues(s));
    expect(same).toEqual({ expectedRevision: 4 });
    expect(isEmptyPatch(same)).toBe(true);
    const moved = toPatch(s, {
      ...sessionValues(s),
      time: "09:30",
      location: "B",
    });
    expect(moved).toEqual({
      expectedRevision: 4,
      startsAt: new Date(2026, 10, 25, 9, 30).toISOString(),
      location: "B",
    });
    expect(isEmptyPatch(moved)).toBe(false);
    const bare = sessionValues(
      session({
        location: null,
        workout: null,
        reminderMinutes: null,
        notes: null,
        attendees: [{ ...session().attendees[0]!, status: "cancelled" }],
      }),
    );
    expect(bare).toMatchObject({
      location: "",
      workoutId: "",
      reminderMinutes: 0,
      clientIds: [],
    });
  });
});

describe("write errors", () => {
  const form = () => ({ setError: vi.fn() });

  it("maps refusals onto fields or the sheet", () => {
    const f = form();
    expect(
      writeError(apiError(404, { code: "workout_not_found" }), f),
    ).toBeNull();
    expect(f.setError).toHaveBeenCalledWith("workoutId", expect.anything());

    const g = form();
    expect(
      writeError(
        apiError(422, {
          code: "invalid_session",
          message: "videoUrl must be an https link",
        }),
        g,
      ),
    ).toBeNull();
    expect(g.setError).toHaveBeenCalledWith("videoUrl", expect.anything());

    expect(
      writeError(apiError(403, { code: "not_your_client" }), form()),
    ).toMatch(/active client/);
    expect(
      writeError(apiError(409, { code: "revision_conflict" }), form()),
    ).toMatch(/changed somewhere else/);
    expect(writeError(apiError(0, null, true), form())).toMatch(/offline/);
    expect(writeError(new Error("x"), form())).toMatch(/couldn't save/);
    expect(writeError(apiError(500, { message: "Boom" }), form())).toBe("Boom");
  });
});

describe("calendar api", () => {
  it("calls the sessions routes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: "w1", name: "A", extra: 1 }] }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(calendarApi.workouts()).resolves.toEqual([
      { id: "w1", name: "A" },
    ]);
    await calendarApi.range("a b", "c");
    await calendarApi.create(
      { kind: "video", startsAt: "x", durationMin: 30 },
      "k1",
    );
    await calendarApi.update("s1", { durationMin: 45 }, "series");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await calendarApi.cancel("s1", "this");
    const calls = (
      fetchMock.mock.calls as unknown as [string, RequestInit][]
    ).map(([url, init]) => [
      url.replace(/^.*?(\/(trainers|workouts))/, "$1"),
      init?.method ?? "GET",
    ]);
    expect(calls).toEqual([
      ["/workouts?type=mine&limit=100", "GET"],
      ["/trainers/me/calendar?from=a%20b&to=c", "GET"],
      ["/trainers/me/sessions", "POST"],
      ["/trainers/me/sessions/s1?scope=series", "PATCH"],
      ["/trainers/me/sessions/s1?scope=this", "DELETE"],
    ]);
    vi.unstubAllGlobals();
  });
});
