import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { saveSession } from "../api/coachAuth";
import { notificationsApi } from "../notifications/api";
import {
  calendarDate,
  channelOptions,
  dayTime,
  describeEvent,
  describeToday,
  feedPeople,
  filterFeed,
  filterToday,
  groupByClient,
  groupSummary,
  kindsFor,
  longDate,
  scheduleRows,
  sessionKindLabel,
  shortTime,
  stripCells,
  todayFilterCounts,
  unreadByType,
  whoHref,
  whoOf,
  withoutItem,
} from "../notifications/lib";
import {
  quietRules,
  quietServerError,
  settingsToValues,
} from "../notifications/settingsForm";
import { TodayContainer } from "../notifications/TodayContainer";
import {
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";
import {
  EVENTS,
  LENA_PROFILE,
  NOW,
  SAM,
  TOM,
  event,
  fakeNotificationsApi,
  feedPage,
  notificationSettings,
  todayItem,
  todayPayload,
} from "./notificationsFixtures";

const at = (dayOffset: number, h: number, m = 0) =>
  new Date(2026, 10, 25 + dayOffset, h, m).toISOString();

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("time labels", () => {
  it("shortTime follows the queue's style", () => {
    expect(shortTime(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe(
      "now",
    );
    expect(shortTime(at(0, 13, 35), NOW)).toBe("25m");
    expect(shortTime(at(0, 12, 0), NOW)).toBe("2h");
    expect(shortTime(at(0, 7, 5), NOW)).toBe("07:05");
    expect(shortTime(at(-1, 9), NOW)).toBe("Yest.");
    expect(shortTime(at(-2, 9), NOW)).toBe("Mon");
    expect(shortTime(at(-20, 9), NOW)).toBe("5 Nov");
    expect(shortTime("nope", NOW)).toBe("");
  });

  it("dayTime and longDate", () => {
    expect(dayTime(at(0, 8, 12), NOW)).toBe("Today 08:12");
    expect(dayTime(at(-3, 10, 14), NOW)).toBe("Sun 10:14");
    expect(dayTime(at(-10, 10), NOW)).toBe("15 Nov");
    expect(dayTime("nope", NOW)).toBe("");
    expect(longDate(NOW)).toBe("Wednesday 25 November");
  });
});

describe("whoOf", () => {
  it("uses the client, else the invited profile, else the practice", () => {
    expect(whoOf(SAM, {})).toMatchObject({
      key: `client:${SAM.id}`,
      initials: "SP",
    });
    expect(whoOf({ ...SAM, name: null }, {}).name).toBe("A client");
    const lena = whoOf(null, { profileId: LENA_PROFILE, displayName: "Lena" });
    expect(lena.key).toBe(`profile:${LENA_PROFILE}`);
    expect(whoHref(lena)).toBe(`/coach/clients/invited/${LENA_PROFILE}`);
    const practice = whoOf(null, {});
    expect(practice).toMatchObject({ key: "practice", name: "Your practice" });
    expect(whoHref(practice)).toBeNull();
    expect(whoHref(whoOf(SAM, {}))).toBe(`/coach/clients/${SAM.id}`);
  });
});

describe("describeEvent", () => {
  it("check-ins and forms link to the Check-ins tab", () => {
    const v = describeEvent(event(), NOW);
    expect(v).toMatchObject({
      title: "Weekly check-in done",
      pill: "Done",
      action: { label: "Review", href: `/coach/clients/${SAM.id}/check-ins` },
    });
    const late = describeEvent(
      event({ kind: "form_completed", payload: { late: true } }),
      NOW,
    );
    expect(late.title).toBe("A form done");
    expect(late.detail).toContain("answered late");
    expect(late.action?.label).toBe("Read");
    expect(
      describeEvent(event({ client: null, payload: {} }), NOW).action,
    ).toBeNull();
  });

  it("a finished workout shows the rating and note (C10e)", () => {
    expect(describeEvent(EVENTS[1]!, NOW)).toMatchObject({
      title: "Upper B done",
      detail: "Tue 18:30 · rated 4/5 · “Bench felt heavy”",
      pill: "Trained",
    });
    expect(
      describeEvent(
        event({ kind: "workout_completed", payload: { difficulty: 7 } }),
        NOW,
      ).detail,
    ).toContain("difficulty 7/10");
    expect(
      describeEvent(event({ kind: "workout_completed", payload: {} }), NOW)
        .title,
    ).toBe("A workout done");
  });

  it("records, missed forms and the other kinds", () => {
    expect(describeEvent(EVENTS[3]!, NOW)).toMatchObject({
      title: "3 new records",
      detail: "Sun 09:00 · Squat · Bench press",
    });
    expect(
      describeEvent(event({ kind: "record_hit", payload: {} }), NOW).title,
    ).toBe("New record");
    expect(describeEvent(EVENTS[2]!, NOW)).toMatchObject({
      title: "Weekly check-in not done",
      pill: "Outstanding",
    });
    expect(
      describeEvent(event({ kind: "form_missed", payload: {} }), NOW).title,
    ).toBe("A form not done");
    expect(describeEvent(EVENTS[4]!, NOW).action).toEqual({
      label: "Resend",
      href: `/coach/clients/invited/${LENA_PROFILE}`,
    });
    expect(
      describeEvent(
        event({ kind: "invite_expired", client: null, payload: {} }),
        NOW,
      ).action,
    ).toBeNull();
    expect(describeEvent(event({ kind: "client_accepted" }), NOW).title).toBe(
      "Accepted your invite",
    );
    expect(
      describeEvent(
        event({
          kind: "programme_ending",
          payload: { programName: "Strength", endDate: "2026-11-30" },
        }),
        NOW,
      ),
    ).toMatchObject({ title: "Strength ends soon" });
    expect(
      describeEvent(
        event({ kind: "programme_ending", payload: { remaining: 1 } }),
        NOW,
      ).detail,
    ).toContain("1 workout left");
    expect(
      describeEvent(
        event({ kind: "training_behind", payload: { done: 1, target: 3 } }),
        NOW,
      ).detail,
    ).toContain("1 of 3 sessions");
    expect(
      describeEvent(
        event({ kind: "training_behind", payload: { label: "1 of 4" } }),
        NOW,
      ).detail,
    ).toContain("1 of 4");
    expect(
      describeEvent(
        event({
          kind: "session_booked",
          payload: {
            action: "booked",
            sessionKind: "video",
            startsAt: at(1, 12, 30),
          },
        }),
        NOW,
      ).title,
    ).toBe("Video call booked");
    expect(
      describeEvent(
        event({ kind: "session_booked", payload: { action: "cancelled" } }),
        NOW,
      ).title,
    ).toBe("Session cancelled");
    expect(
      describeEvent(
        event({ kind: "session_booked", payload: { action: "moved" } }),
        NOW,
      ).title,
    ).toBe("Session moved");
    expect(describeEvent(event({ kind: "message_received" }), NOW).title).toBe(
      "New message",
    );
    expect(describeEvent(event({ kind: "something_new" }), NOW).title).toBe(
      "A new update",
    );
    expect(sessionKindLabel("own_training")).toBe("Your training");
  });
});

describe("feed filters and grouping", () => {
  it("filters by type and person, and counts unread per type", () => {
    expect(kindsFor("all")).toBeNull();
    expect(
      filterFeed(EVENTS, { type: "workouts", who: null }).map((e) => e.id),
    ).toEqual(["e-2", "e-4"]);
    expect(
      filterFeed(EVENTS, { type: "all", who: `client:${TOM.id}` }).map(
        (e) => e.id,
      ),
    ).toEqual(["e-3", "e-4"]);
    expect(unreadByType(EVENTS)).toEqual({
      all: 3,
      "check-ins": 1,
      forms: 0,
      workouts: 1,
      missed: 1,
    });
  });

  it("groups by person with a summary", () => {
    const groups = groupByClient(EVENTS);
    expect(groups.map((g) => g.who.name)).toEqual([
      "Sam Patel",
      "Tom Reid",
      "Lena Ortiz",
    ]);
    expect(groupSummary(groups[0]!)).toBe("2 new");
    expect(groupSummary(groups[1]!)).toBe("1 new · 1 outstanding");
    expect(groupSummary(groups[2]!)).toBe("Nothing new");
    expect(feedPeople(EVENTS).map((w) => w.name)).toEqual([
      "Lena Ortiz",
      "Sam Patel",
      "Tom Reid",
    ]);
  });
});

describe("Today helpers", () => {
  it("describes each queue item with one action", () => {
    expect(describeToday(todayItem())).toEqual({
      label: "Weekly check-in",
      tone: "violet",
      facts: "New answers to review",
      action: {
        kind: "link",
        label: "Review",
        href: `/coach/clients/${SAM.id}/check-ins`,
      },
    });
    expect(describeToday(todayItem({ facts: { late: true } }))).toMatchObject({
      label: "Form completed",
      facts: "Answered late",
    });
    const missed = describeToday(
      todayItem({ kind: "form_missed", action: "nudge_client", facts: {} }),
    );
    expect(missed).toMatchObject({
      label: "Missed a form",
      tone: "ember",
      action: { kind: "done", label: "Done" },
    });
    expect(
      describeToday(
        todayItem({
          kind: "invite_expired",
          client: null,
          facts: { profileId: LENA_PROFILE },
          action: "resend_invite",
        }),
      ).action,
    ).toEqual({
      kind: "link",
      label: "Resend",
      href: `/coach/clients/invited/${LENA_PROFILE}`,
    });
    expect(
      describeToday(
        todayItem({ kind: "training_behind", facts: { done: 1, target: 4 } }),
      ).facts,
    ).toBe("1 of 4 sessions in the last 7 days");
    expect(
      describeToday(todayItem({ kind: "training_behind", facts: {} })).facts,
    ).toBe("Fewer sessions than their target");
    expect(
      describeToday(
        todayItem({
          kind: "programme_ending",
          facts: { programName: "Cut", endDate: "2026-11-30", remaining: 2 },
        }),
      ),
    ).toMatchObject({
      label: "Programme ends 30 Nov",
      facts: "Cut · 2 workouts left",
    });
    expect(
      describeToday(todayItem({ kind: "programme_ending", facts: {} })).label,
    ).toBe("Programme ends soon");
    expect(
      describeToday(todayItem({ kind: "client_accepted", facts: {} })).label,
    ).toBe("Accepted your invite");
    expect(
      describeToday(
        todayItem({ kind: "message_received", facts: { preview: "Hi" } }),
      ).facts,
    ).toBe("Hi");
    expect(describeToday(todayItem({ kind: "other", facts: {} })).label).toBe(
      "Needs you",
    );
    // Review needs a client to open.
    expect(
      describeToday(todayItem({ client: null, facts: {} })).action.kind,
    ).toBe("done");
  });

  it("a programme's end date stays on its calendar day west of UTC", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const d = calendarDate("2026-11-30");
      expect([
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
      ]).toEqual([2026, 10, 30, 0]);
      expect(
        describeToday(
          todayItem({
            kind: "programme_ending",
            facts: { endDate: "2026-11-30" },
          }),
        ).label,
      ).toBe("Programme ends 30 Nov");
      expect(
        describeEvent(
          event({
            kind: "programme_ending",
            payload: { endDate: "2026-11-30" },
          }),
          NOW,
        ).detail,
      ).toContain("ends 30 Nov");
      expect(calendarDate("2026-11-30T12:00:00Z").toISOString()).toBe(
        "2026-11-30T12:00:00.000Z",
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("filter chips show only kinds with items", () => {
    expect(
      todayFilterCounts({ check_in_completed: 2, form_missed: 1 }, 3),
    ).toEqual([
      { id: "all", label: "All", count: 3 },
      { id: "check-ins", label: "Check-ins", count: 2 },
      { id: "flags", label: "Flags", count: 1 },
    ]);
    const q = todayPayload().queue;
    expect(filterToday(q, "all")).toHaveLength(3);
    expect(filterToday(q, "flags").map((i) => i.eventId)).toEqual(["e-3"]);
  });

  it("withoutItem drops one item and lowers its counts", () => {
    const t = todayPayload();
    const next = withoutItem(t, "e-3");
    expect(next.queue.map((i) => i.eventId)).toEqual(["e-1", "e-5"]);
    expect(next.counts).toEqual({
      total: 2,
      byKind: { check_in_completed: 1, form_missed: 0, invite_expired: 1 },
    });
    expect(withoutItem(t, "missing")).toBe(t);
    const odd = withoutItem({ ...t, counts: { total: 0, byKind: {} } }, "e-1");
    expect(odd.counts).toEqual({ total: 0, byKind: { check_in_completed: 0 } });
  });

  it("the strip has one cell per tracked area, never a blended score", () => {
    expect(stripCells(3, 14, todayPayload().strip)).toEqual([
      { key: "need", value: "3", of: null, label: "Need you" },
      { key: "clients", value: "14", of: null, label: "Active clients" },
      { key: "training", value: "9", of: "/12", label: "Training · sessions" },
      {
        key: "calories",
        value: "10",
        of: "/14",
        label: "Calories · days on target",
      },
    ]);
    expect(
      stripCells(0, null, {
        training: { done: 0, target: 0, clients: 1 },
        calories: {
          daysOnTarget: 0,
          daysCounted: 0,
          daysNotLogged: 0,
          clients: 1,
        },
      }).map((c) => c.key),
    ).toEqual(["need"]);
  });

  it("schedule rows: done, next, and the coach's own training", () => {
    const rows = scheduleRows(
      [
        ...todayPayload().schedule,
        {
          id: "s-x",
          kind: "video",
          startsAt: at(0, 12, 30),
          endsAt: at(0, 13, 15),
          durationMin: 45,
          location: null,
          workout: null,
          cancelledAt: at(0, 9),
          attendees: [],
        },
        {
          id: "s-3",
          kind: "check_in_call",
          startsAt: at(0, 15, 0),
          endsAt: at(0, 15, 30),
          durationMin: 30,
          location: null,
          workout: null,
          cancelledAt: null,
          attendees: [
            { clientId: TOM.id, name: null, status: "invited" },
            { clientId: SAM.id, name: "Sam", status: "declined" },
          ],
        },
        {
          id: "s-4",
          kind: "video",
          startsAt: at(0, 16, 0),
          endsAt: at(0, 16, 30),
          durationMin: 30,
          location: null,
          workout: null,
          cancelledAt: null,
          attendees: [],
        },
      ],
      NOW,
    );
    expect(rows).toEqual([
      {
        id: "s-1",
        time: "07:00",
        title: "Sam Patel",
        sub: "In person · Studio A",
        own: false,
        state: "done",
      },
      {
        id: "s-3",
        time: "15:00",
        title: "A client",
        sub: "Check-in call · 30 min",
        own: false,
        state: "next",
      },
      {
        id: "s-4",
        time: "16:00",
        title: "Video call",
        sub: "Video call · 30 min",
        own: false,
        state: null,
      },
      {
        id: "s-2",
        time: "18:00",
        title: "Your training",
        sub: "Upper A · 60 min",
        own: true,
        state: null,
      },
    ]);
  });

  it("email channels stay hidden while email isn't available", () => {
    expect(channelOptions(false, "push")).toEqual(["push", "off"]);
    expect(channelOptions(false, "both")).toEqual(["push", "off", "both"]);
    expect(channelOptions(true, "off")).toEqual([
      "push",
      "email",
      "both",
      "off",
    ]);
  });
});

describe("settings form rules", () => {
  const base = settingsToValues(notificationSettings());
  it("quiet hours need two different times when on", () => {
    expect(quietRules(base)).toEqual({});
    expect(quietRules({ ...base, quietEnabled: true })).toEqual({
      quietFrom: "Choose when quiet hours start and end.",
    });
    expect(
      quietRules({ ...base, quietEnabled: true, quietFrom: "21:00" }),
    ).toEqual({ quietUntil: "Choose when quiet hours start and end." });
    expect(
      quietRules({
        ...base,
        quietEnabled: true,
        quietFrom: "21:00",
        quietUntil: "21:00",
      }),
    ).toEqual({ quietUntil: "Start and end need to be different times." });
    expect(
      quietRules({
        ...base,
        quietEnabled: true,
        quietFrom: "21:00",
        quietUntil: "07:00",
      }),
    ).toEqual({});
  });

  it("maps the route's 400s onto the time fields", () => {
    const e = (message: string, code = "invalid_settings", status = 400) => ({
      status,
      body: { code, message },
    });
    expect(
      quietServerError(e("quiet hours from and until must differ")),
    ).toEqual({
      field: "quietUntil",
      message: "Start and end need to be different times.",
    });
    expect(quietServerError(e("quiet hours must be HH:MM"))?.field).toBe(
      "quietFrom",
    );
    expect(
      quietServerError(e("quiet hours need from and until"))?.message,
    ).toBe("Choose when quiet hours start and end.");
    expect(quietServerError(e("unknown event kind: x"))).toBeNull();
    expect(quietServerError(e("quiet hours", "other"))).toBeNull();
    expect(
      quietServerError(e("quiet hours", "invalid_settings", 409)),
    ).toBeNull();
    expect(quietServerError(null)).toBeNull();
    expect(quietServerError({ status: 400, body: null })).toBeNull();
  });
});

// ─── API ─────────────────────────────────────────────────────────────────────

describe("notificationsApi", () => {
  it("calls each route with the right method, path and body", async () => {
    vi.stubEnv("VITE_CORE_API_URL", "https://api.test/");
    saveSession({
      accessToken: "a.eyJleHAiOjk5OTk5OTk5OTl9.s",
      refreshToken: null,
      expiresAt: 9_999_999_999,
      email: "e@x.co",
    });
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/read"))
          return new Response(JSON.stringify({ data: { updated: 2 } }));
        if (url.includes("/trainers/me/notifications?"))
          return new Response(JSON.stringify(feedPage()));
        return new Response(JSON.stringify({ data: "ok" }));
      }),
    );
    expect((await notificationsApi.feed()).unreadCount).toBe(3);
    expect(await notificationsApi.markRead(["a"])).toBe(2);
    expect(await notificationsApi.markRead("all")).toBe(2);
    expect(await notificationsApi.today()).toBe("ok");
    expect(await notificationsApi.actioned("e/1")).toBe("ok");
    expect(await notificationsApi.settings()).toBe("ok");
    expect(
      await notificationsApi.putSettings({ channels: { record_hit: "off" } }),
    ).toBe("ok");
    const seen = calls.map((c) => [
      c.init?.method ?? "GET",
      c.url.replace("https://api.test", ""),
      c.init?.body ?? null,
    ]);
    expect(seen).toEqual([
      ["GET", "/trainers/me/notifications?limit=200", null],
      ["POST", "/trainers/me/notifications/read", '{"ids":["a"]}'],
      ["POST", "/trainers/me/notifications/read", '{"all":true}'],
      ["GET", "/trainers/me/today", null],
      ["POST", "/trainers/me/today/e%2F1/actioned", "{}"],
      ["GET", "/trainers/me/notification-settings", null],
      [
        "PUT",
        "/trainers/me/notification-settings",
        '{"channels":{"record_hit":"off"}}',
      ],
    ]);
  });
});

// ─── Today (C2a) ─────────────────────────────────────────────────────────────

function renderToday(notifications = fakeNotificationsApi()) {
  return renderCoach(<TodayContainer now={() => NOW} />, {
    route: "/coach/today",
    path: "/coach/today",
    api: fakeApi(),
    notifications,
  });
}

describe("TodayContainer", () => {
  it("shows the strip, the queue with one action each, and the schedule", async () => {
    const n = fakeNotificationsApi({
      today: vi.fn().mockResolvedValue(todayPayload()),
    });
    renderToday(n);
    expect(await screen.findByText("Wednesday 25 November")).toBeTruthy();
    expect(screen.getByText("Need you")).toBeTruthy();
    expect(screen.getByText("Training · sessions")).toBeTruthy();
    expect(screen.queryByText(/adherence/i)).toBeNull();
    await waitFor(() =>
      expect(screen.getByText("Active clients")).toBeTruthy(),
    );
    const queue = screen.getByRole("list", { name: "Queue" });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(3);
    expect(within(queue).getByText("Missed Weekly check-in")).toBeTruthy();
    expect(within(queue).getByText("2h")).toBeTruthy();
    const schedule = screen.getByRole("list", { name: "Schedule" });
    expect(within(schedule).getByText("Your training")).toBeTruthy();
    expect(within(schedule).getByText("Done")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Invite client" }).getAttribute("href"),
    ).toBe("/coach/clients/new");
  });

  it("filters the queue with the chips", async () => {
    renderToday(
      fakeNotificationsApi({
        today: vi.fn().mockResolvedValue(todayPayload()),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Flags/ }));
    const queue = screen.getByRole("list", { name: "Queue" });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen
        .getByRole("button", { name: /Flags/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("Done marks the item actioned and drops it from the queue", async () => {
    const n = fakeNotificationsApi({
      today: vi.fn().mockResolvedValue(todayPayload()),
    });
    renderToday(n);
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark done: Tom Reid/ }),
    );
    await waitFor(() => expect(n.actioned).toHaveBeenCalledWith("e-3"));
    await waitFor(() =>
      expect(screen.queryByText("Missed Weekly check-in")).toBeNull(),
    );
    expect(
      within(screen.getByRole("group", { name: "Show" })).getByRole("button", {
        name: /All/,
      }).textContent,
    ).toContain("2");
  });

  it("Review opens the client's check-ins and marks the item done", async () => {
    const n = fakeNotificationsApi({
      today: vi.fn().mockResolvedValue(todayPayload()),
    });
    renderToday(n);
    fireEvent.click(
      await screen.findByRole("link", { name: /Review Sam Patel/ }),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${SAM.id}/check-ins`),
    );
    expect(n.actioned).toHaveBeenCalledWith("e-1");
  });

  it("says so when marking done fails, offline or gone", async () => {
    const actioned = vi
      .fn()
      .mockRejectedValueOnce(apiError(0, null, true))
      .mockRejectedValueOnce(apiError(404, { code: "event_not_found" }));
    renderToday(
      fakeNotificationsApi({
        today: vi.fn().mockResolvedValue(todayPayload()),
        actioned,
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark done: Tom Reid/ }),
    );
    expect(await screen.findByText(/You're offline/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Mark done: Tom Reid/ }),
    );
    expect(
      await screen.findByText("That item is no longer in your queue."),
    ).toBeTruthy();
    expect(screen.queryByText("Missed Weekly check-in")).toBeNull();
  });

  it("says so when marking done fails on the server", async () => {
    renderToday(
      fakeNotificationsApi({
        today: vi.fn().mockResolvedValue(todayPayload()),
        actioned: vi.fn().mockRejectedValue(apiError(500, null)),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark done: Tom Reid/ }),
    );
    expect(await screen.findByText("We couldn't mark that done.")).toBeTruthy();
    expect(screen.getByText("Missed Weekly check-in")).toBeTruthy();
  });

  it("shows All clear with nothing in the queue", async () => {
    renderToday();
    expect(await screen.findByText("All clear")).toBeTruthy();
    expect(screen.getByText("Nothing booked today.")).toBeTruthy();
  });

  it("load errors offer a retry", async () => {
    const today = vi
      .fn()
      .mockRejectedValueOnce(apiError(0, null, true))
      .mockResolvedValue(todayPayload());
    renderToday(fakeNotificationsApi({ today }));
    expect(
      await screen.findByText("You're offline. Connect to load Today."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Need you")).toBeTruthy();
  });

  it("a server failure loading Today says so", async () => {
    renderToday(
      fakeNotificationsApi({
        today: vi.fn().mockRejectedValue(apiError(500, null)),
      }),
    );
    expect(await screen.findByText("We couldn't load Today.")).toBeTruthy();
  });
});
