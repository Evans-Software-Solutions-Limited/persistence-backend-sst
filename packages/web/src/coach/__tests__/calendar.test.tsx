import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CalendarContainer } from "../calendar/CalendarContainer";
import { ClientPage } from "../clients/ClientPage";
import {
  CLIENT_ID,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
  settings,
} from "./helpers";
import {
  NOW,
  at,
  fakeCalendarApi,
  formDue,
  range,
  session,
  withCalendar,
  type FakeCalendarApi,
} from "./calendarFixtures";

const CAL = "/coach/today/calendar";

function renderCalendar(cal: FakeCalendarApi, route = CAL) {
  return renderCoach(withCalendar(<CalendarContainer now={NOW} />, cal), {
    route,
    path: "/coach/today/calendar",
    api: fakeApi(),
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("Calendar (C4a)", () => {
  it("shows the week with sessions, forms due and the key", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(
        range({
          sessions: [
            session(),
            session({
              id: "s2",
              kind: "own_training",
              attendees: [],
              startsAt: at(24, 17),
              workout: { id: "w2", name: "Lower A" },
            }),
            session({
              id: "s3",
              kind: "video",
              startsAt: at(26, 12, 30),
              cancelledAt: at(24, 9),
            }),
          ],
          formsDue: [
            formDue(),
            formDue({
              requestId: "q2",
              client: { id: "c2", name: "Priya Shah", avatarUrl: null },
            }),
          ],
        }),
      ),
    });
    renderCalendar(cal);
    expect(await screen.findAllByText("Sam Patel")).toHaveLength(2);
    expect(screen.getByText("Week 48 · 23 Nov – 29 Nov")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Calendar" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Queue" }).getAttribute("href"),
    ).toBe("/coach/today");
    expect(screen.getByText("Lower A")).toBeTruthy();
    expect(screen.getByText("Cancelled · video call")).toBeTruthy();
    expect(screen.getByText("Weekly check-in due")).toBeTruthy();
    expect(screen.getByText("2 clients")).toBeTruthy();
    const key = screen.getByRole("list", { name: "Key" });
    expect(within(key).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "This week" })).toHaveProperty(
      "disabled",
      true,
    );
    const [from, to] = cal.range.mock.calls[0] as [string, string];
    expect(new Date(from).getDate()).toBe(23);
    expect(new Date(to).getDate()).toBe(30);
  });

  it("moves between weeks through the URL", async () => {
    const cal = fakeCalendarApi();
    renderCalendar(cal, `${CAL}?week=2026-11-30`);
    expect(await screen.findByText("Week 49 · 30 Nov – 6 Dec")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(await screen.findByText("Week 48 · 23 Nov – 29 Nov")).toBeTruthy();
    expect(currentPath()).toContain("week=2026-11-23");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(await screen.findByText("Week 50 · 7 Dec – 13 Dec")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(await screen.findByText("Week 48 · 23 Nov – 29 Nov")).toBeTruthy();
  });

  it("says when the week is empty, failed or offline", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(range({ sessions: [] })),
    });
    renderCalendar(cal);
    expect(await screen.findByText(/Nothing booked this week/)).toBeTruthy();
    cleanup();

    const failing = fakeCalendarApi({
      range: vi.fn().mockRejectedValue(apiError(500, null)),
    });
    renderCalendar(failing);
    expect(
      await screen.findByText("We couldn't load your calendar."),
    ).toBeTruthy();
    failing.range.mockResolvedValue(range());
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Sam Patel")).toBeTruthy();
    cleanup();

    setOnline(false);
    const offline = fakeCalendarApi({
      range: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCalendar(offline);
    expect(
      await screen.findByText(/Your calendar loads when you're back online/),
    ).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("lists who a form is due from", async () => {
    const cal = fakeCalendarApi({
      range: vi
        .fn()
        .mockResolvedValue(
          range({ sessions: [], formsDue: [formDue({ late: true })] }),
        ),
    });
    renderCalendar(cal);
    fireEvent.click(
      await screen.findByRole("button", { name: /Weekly check-in due/ }),
    );
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/1 client · 1 late/)).toBeTruthy();
    expect(
      within(dlg).getByRole("link", { name: "Sam Patel" }).getAttribute("href"),
    ).toBe(`/coach/clients/${CLIENT_ID}/check-ins`);
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a session and cancels this one or the series", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(
        range({
          sessions: [
            session({
              seriesId: "series-1",
              notes: "Bring straps",
              attendees: [{ ...session().attendees[0]!, status: "accepted" }],
            }),
          ],
        }),
      ),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: /Sam Patel/ }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("Accepted")).toBeTruthy();
    expect(within(dlg).getByText("Weekly")).toBeTruthy();
    expect(within(dlg).getByText("2 h before")).toBeTruthy();
    expect(within(dlg).getByText("Bring straps")).toBeTruthy();

    fireEvent.click(
      within(dlg).getByRole("button", { name: "Cancel session" }),
    );
    fireEvent.click(within(dlg).getByRole("button", { name: "Keep it" }));
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Cancel session" }),
    );
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Cancel this and later" }),
    );
    await waitFor(() =>
      expect(cal.cancel).toHaveBeenCalledWith("s1", "series"),
    );
    expect(await screen.findByText("Sessions cancelled")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when a cancel fails, and hides actions on past or cancelled sessions", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(
        range({
          sessions: [
            session({
              kind: "video",
              videoUrl: "https://meet.example/x",
              location: null,
            }),
            session({ id: "past", startsAt: at(23, 8), attendees: [] }),
          ],
        }),
      ),
      cancel: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: /Sam Patel/ }));
    let dlg = screen.getByRole("dialog");
    expect(
      within(dlg).getByRole("link", { name: "https://meet.example/x" }),
    ).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Cancel session" }),
    );
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Cancel session" }),
    );
    expect(
      await within(dlg).findByText(/Cancelling needs a connection/),
    ).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /In person/ }));
    dlg = screen.getByRole("dialog");
    expect(within(dlg).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("schedules from the calendar, with a client picked", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(range({ sessions: [] })),
      create: vi.fn().mockResolvedValue({
        data: session({ startsAt: at(30, 7) }),
        series: [session(), session({ id: "s2" })],
      }),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    const dlg = screen.getByRole("dialog", { name: "Schedule" });
    // No client yet: the form says so.
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    expect(
      await within(dlg).findByText("Pick who this session is with."),
    ).toBeTruthy();
    fireEvent.click(
      await within(dlg).findByRole("checkbox", { name: "Sam Patel" }),
    );
    fireEvent.change(within(dlg).getByLabelText("Date"), {
      target: { value: "2099-01-05" },
    });
    fireEvent.change(within(dlg).getByLabelText("Where"), {
      target: { value: "Studio A" },
    });
    fireEvent.change(within(dlg).getByLabelText("Repeats"), {
      target: { value: "2" },
    });
    fireEvent.change(await within(dlg).findByLabelText("Workout"), {
      target: { value: "w1" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(cal.create).toHaveBeenCalled());
    const [body, key] = cal.create.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(body).toMatchObject({
      kind: "in_person",
      location: "Studio A",
      clientIds: [CLIENT_ID],
      workoutId: "w1",
      reminderMinutes: 120,
      repeat: { frequency: "weekly", count: 2 },
    });
    expect(typeof key).toBe("string");
    expect(await screen.findByText("2 sessions scheduled")).toBeTruthy();
    expect(currentPath()).toContain("week=2026-11-30");
  });

  it("books your own training with no clients or reminder", async () => {
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(range({ sessions: [] })),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.click(within(dlg).getByRole("tab", { name: "Your training" }));
    expect(within(dlg).queryByRole("checkbox")).toBeNull();
    expect(within(dlg).queryByLabelText(/gets/)).toBeNull();
    fireEvent.change(within(dlg).getByLabelText("Date"), {
      target: { value: "2099-01-05" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(cal.create).toHaveBeenCalled());
    expect(cal.create.mock.calls[0]![0]).toMatchObject({
      kind: "own_training",
      clientIds: [],
      reminderMinutes: null,
    });
    expect(await screen.findByText("Session scheduled")).toBeTruthy();
  });

  it("edits one occurrence, puts server errors on fields, and handles a stale copy", async () => {
    const s = session({ seriesId: "series-1", revision: 3 });
    const cal = fakeCalendarApi({
      range: vi.fn().mockResolvedValue(range({ sessions: [s] })),
      update: vi
        .fn()
        .mockRejectedValueOnce(apiError(404, { code: "workout_not_found" }))
        .mockRejectedValueOnce(apiError(409, { code: "revision_conflict" }))
        .mockResolvedValueOnce({ data: s, series: [s, { ...s, id: "s9" }] }),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: /Sam Patel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit session" });
    expect(within(dlg).getByText("Sam Patel")).toBeTruthy();
    // Nothing changed: Save just closes.
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit session" })).toBeNull(),
    );
    expect(cal.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const again = screen.getByRole("dialog", { name: "Edit session" });
    fireEvent.change(within(again).getByLabelText("Time"), {
      target: { value: "09:30" },
    });
    fireEvent.click(
      within(again).getByRole("button", { name: "This and later" }),
    );
    fireEvent.click(within(again).getByRole("button", { name: "Save" }));
    expect(
      await within(again).findByText(
        "That workout isn't in your library any more.",
      ),
    ).toBeTruthy();
    const [id, patch, scope] = cal.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect([id, scope]).toEqual(["s1", "series"]);
    expect(patch).toEqual({
      expectedRevision: 3,
      startsAt: new Date(2026, 10, 25, 9, 30).toISOString(),
    });

    fireEvent.click(within(again).getByRole("button", { name: "Save" }));
    expect(
      await within(again).findByText(/changed somewhere else/),
    ).toBeTruthy();
    fireEvent.click(within(again).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("2 sessions updated")).toBeTruthy();
  });
});

describe("Schedule sheet details", () => {
  it("keeps an odd length, switches scope back and unticks a client", async () => {
    const cal = fakeCalendarApi({
      range: vi
        .fn()
        .mockResolvedValue(
          range({ sessions: [session({ seriesId: "x", durationMin: 50 })] }),
        ),
    });
    renderCalendar(cal);
    fireEvent.click(await screen.findByRole("button", { name: /Sam Patel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    let dlg = screen.getByRole("dialog", { name: "Edit session" });
    expect(within(dlg).getByRole("option", { name: "50 min" })).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "This and later" }),
    );
    fireEvent.click(within(dlg).getByRole("button", { name: "This session" }));
    expect(
      within(dlg)
        .getByRole("button", { name: "This session" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.keyDown(dlg, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    dlg = screen.getByRole("dialog", { name: "Schedule" });
    const box = await within(dlg).findByRole("checkbox", { name: "Sam Patel" });
    fireEvent.click(box);
    expect(box).toHaveProperty("checked", true);
    fireEvent.click(box);
    expect(box).toHaveProperty("checked", false);
  });
});

describe("Schedule from Client Detail (C4c)", () => {
  const PAGE = `/coach/clients/${CLIENT_ID}/settings`;
  const PATH = "/coach/clients/:clientId/:tab?";

  it("opens 'Schedule with Sam', maps a 422 and links to the week", async () => {
    const cal = fakeCalendarApi({
      create: vi
        .fn()
        .mockRejectedValueOnce(
          apiError(422, {
            code: "invalid_session",
            message: "videoUrl must be an https link",
          }),
        )
        .mockResolvedValueOnce({
          data: session({ startsAt: at(30, 7) }),
          series: [session()],
        }),
    });
    renderCoach(withCalendar(<ClientPage />, cal), {
      route: PAGE,
      path: PATH,
      api: fakeApi({ settings: vi.fn().mockResolvedValue(settings()) }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    const dlg = screen.getByRole("dialog", { name: "Schedule with Sam" });
    expect(
      within(dlg).queryByRole("tab", { name: "Your training" }),
    ).toBeNull();
    expect(within(dlg).queryByRole("checkbox")).toBeNull();
    fireEvent.click(within(dlg).getByRole("tab", { name: "Video call" }));
    expect(within(dlg).getByLabelText("Sam gets")).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Video link"), {
      target: { value: "https://meet.example/x" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    expect(await within(dlg).findByText("Use an https:// link.")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    const link = await screen.findByRole("link", { name: "See calendar" });
    expect(link.getAttribute("href")).toBe(
      "/coach/today/calendar?week=2026-11-30",
    );
    expect(cal.create.mock.calls[1]![0]).toMatchObject({
      kind: "video",
      clientIds: [CLIENT_ID],
      videoUrl: "https://meet.example/x",
      location: null,
    });
  });

  it("says when scheduling is offline", async () => {
    const cal = fakeCalendarApi({
      create: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCoach(withCalendar(<ClientPage />, cal), {
      route: PAGE,
      path: PATH,
      api: fakeApi({ settings: vi.fn().mockResolvedValue(settings()) }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Schedule" }));
    expect(
      await within(dlg).findByText(/Scheduling needs a connection/),
    ).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
