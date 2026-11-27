import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { saveSession } from "../api/coachAuth";
import { NotificationsContainer } from "../notifications/NotificationsContainer";
import { NotificationSettingsContainer } from "../notifications/NotificationSettingsContainer";
import { TodayContainer } from "../notifications/TodayContainer";
import { CoachLayout } from "../shell/CoachLayout";
import { placeFor } from "../shell/places";
import {
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";
import {
  NOW,
  SAM,
  TOM,
  fakeNotificationsApi,
  feedPage,
  notificationSettings,
  todayPayload,
} from "./notificationsFixtures";

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => setOnline(true));

// ─── Notifications (C10e) ────────────────────────────────────────────────────

function renderFeed(notifications = fakeNotificationsApi()) {
  return renderCoach(<NotificationsContainer now={() => NOW} />, {
    route: "/coach/notifications",
    path: "/coach/notifications",
    api: fakeApi(),
    notifications,
  });
}

const withFeed = (over = {}) =>
  fakeNotificationsApi({
    feed: vi.fn().mockResolvedValue(feedPage()),
    ...over,
  });

describe("NotificationsContainer", () => {
  it("groups by client, newest first; quiet clients collapse", async () => {
    renderFeed(withFeed());
    const sam = await screen.findByRole("region", { name: "Sam Patel" });
    expect(within(sam).getByText("2 new")).toBeTruthy();
    expect(within(sam).getByText("Weekly check-in done")).toBeTruthy();
    expect(
      within(sam).getByText(/rated 4\/5 · “Bench felt heavy”/),
    ).toBeTruthy();
    expect(
      within(sam).getByRole("link", { name: "Review" }).getAttribute("href"),
    ).toBe(`/coach/clients/${SAM.id}/check-ins`);
    expect(
      within(sam)
        .getByRole("link", { name: "Open client" })
        .getAttribute("href"),
    ).toBe(`/coach/clients/${SAM.id}`);
    const tom = screen.getByRole("region", { name: "Tom Reid" });
    expect(within(tom).getByText("1 new · 1 outstanding")).toBeTruthy();
    expect(within(tom).getByText("Outstanding")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Lena Ortiz" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 client with nothing new" }),
    );
    const lena = screen.getByRole("region", { name: "Lena Ortiz" });
    expect(within(lena).getByText("Nothing new")).toBeTruthy();
    expect(within(lena).queryByRole("button", { name: /Mark/ })).toBeNull();
  });

  it("filters by type and client, and lists the latest", async () => {
    renderFeed(withFeed());
    const types = await screen.findByRole("group", { name: "Type" });
    expect(
      within(types).getByRole("button", { name: /All/ }).textContent,
    ).toContain("3");
    fireEvent.click(within(types).getByRole("button", { name: /Workouts/ }));
    expect(screen.queryByText("Weekly check-in done")).toBeNull();
    expect(screen.getByText("Upper B done")).toBeTruthy();
    fireEvent.click(within(types).getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByLabelText("Client"), {
      target: { value: `client:${TOM.id}` },
    });
    expect(screen.queryByRole("region", { name: "Sam Patel" })).toBeNull();
    expect(screen.getByRole("region", { name: "Tom Reid" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Client"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Invite code expired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "By client" }));
    expect(screen.getByRole("region", { name: "Sam Patel" })).toBeTruthy();
  });

  it("marks one client read, then everything", async () => {
    const n = withFeed();
    renderFeed(n);
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark Sam Patel read" }),
    );
    await waitFor(() =>
      expect(n.markRead).toHaveBeenCalledWith(["e-1", "e-2"]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sam Patel" })).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Show 2 clients with nothing new" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    // Only the unread events on screen, never `{all: true}` (Inspector Brad, #578).
    await waitFor(() => expect(n.markRead).toHaveBeenLastCalledWith(["e-3"]));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Mark all read",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });

  it("read marks that fail say so", async () => {
    const n = withFeed({
      markRead: vi
        .fn()
        .mockRejectedValueOnce(apiError(0, null, true))
        .mockRejectedValueOnce(apiError(500, null)),
    });
    renderFeed(n);
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );
    expect(await screen.findByText(/You're offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark Tom Reid read" }));
    expect(
      await screen.findByText("We couldn't mark those read."),
    ).toBeTruthy();
  });

  it("an empty feed, and load errors", async () => {
    renderFeed();
    expect(await screen.findByText("No notifications")).toBeTruthy();
  });

  it("load errors offer a retry", async () => {
    const feed = vi
      .fn()
      .mockRejectedValueOnce(apiError(0, null, true))
      .mockRejectedValueOnce(apiError(500, null));
    renderFeed(fakeNotificationsApi({ feed }));
    expect(
      await screen.findByText(
        "You're offline. Connect to load your notifications.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("We couldn't load your notifications."),
    ).toBeTruthy();
  });

  it("links to notification settings", async () => {
    renderFeed(withFeed());
    expect(
      (
        await screen.findByRole("link", { name: "Notification settings" })
      ).getAttribute("href"),
    ).toBe("/coach/notifications/settings");
  });
});

// ─── Settings (C6b) ──────────────────────────────────────────────────────────

function renderSettings(notifications = fakeNotificationsApi()) {
  return renderCoach(<NotificationSettingsContainer />, {
    route: "/coach/notifications/settings",
    path: "/coach/notifications/settings",
    api: fakeApi(),
    notifications,
  });
}

describe("NotificationSettingsContainer", () => {
  it("one dropdown per event, without email while it's unavailable", async () => {
    renderSettings();
    const workout = (await screen.findByLabelText(
      "Workout completed",
    )) as HTMLSelectElement;
    expect(workout.value).toBe("off");
    expect([...workout.options].map((o) => o.text)).toEqual([
      "Notification",
      "Off",
    ]);
    expect(screen.queryByText(/Emails still arrive/)).toBeNull();
    expect(screen.getByText("In your time zone (Europe/London).")).toBeTruthy();
    expect(screen.queryByLabelText("Session booked")).toBeNull();
  });

  it("shows email choices when the server offers them", async () => {
    renderSettings(
      fakeNotificationsApi({
        settings: vi
          .fn()
          .mockResolvedValue(notificationSettings({ emailAvailable: true })),
      }),
    );
    const sel = (await screen.findByLabelText(
      "New record",
    )) as HTMLSelectElement;
    expect(sel.options).toHaveLength(4);
    expect(screen.getByText(/Emails still arrive/)).toBeTruthy();
  });

  it("saves a channel with the revision", async () => {
    const saved = notificationSettings({
      revision: 3,
      channels: {
        ...notificationSettings().channels,
        workout_completed: "push",
      },
    });
    const n = fakeNotificationsApi({
      putSettings: vi.fn().mockResolvedValue(saved),
    });
    renderSettings(n);
    fireEvent.change(await screen.findByLabelText("Workout completed"), {
      target: { value: "push" },
    });
    await waitFor(() =>
      expect(n.putSettings).toHaveBeenCalledWith({
        channels: { workout_completed: "push" },
        expectedRevision: 2,
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Workout completed") as HTMLSelectElement).value,
      ).toBe("push"),
    );
  });

  it("turning quiet hours on sends the suggested window", async () => {
    const n = fakeNotificationsApi({
      putSettings: vi.fn().mockResolvedValue(
        notificationSettings({
          revision: 3,
          quietHours: { enabled: true, from: "21:00", until: "07:00" },
        }),
      ),
    });
    renderSettings(n);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Use quiet hours" }),
    );
    await waitFor(() =>
      expect(n.putSettings).toHaveBeenCalledWith({
        quietHours: { enabled: true, from: "21:00", until: "07:00" },
        expectedRevision: 2,
      }),
    );
    expect(
      ((await screen.findByLabelText("From")) as HTMLInputElement).value,
    ).toBe("21:00");
  });

  it("the same start and end is refused before anything is sent", async () => {
    const n = fakeNotificationsApi({
      settings: vi.fn().mockResolvedValue(
        notificationSettings({
          quietHours: { enabled: true, from: "21:00", until: "07:00" },
        }),
      ),
    });
    renderSettings(n);
    const until = await screen.findByLabelText("Until");
    fireEvent.change(until, { target: { value: "21:00" } });
    fireEvent.blur(until);
    expect(
      await screen.findByText("Start and end need to be different times."),
    ).toBeTruthy();
    expect(n.putSettings).not.toHaveBeenCalled();
  });

  it("turning quiet hours off saves", async () => {
    const n = fakeNotificationsApi({
      settings: vi.fn().mockResolvedValue(
        notificationSettings({
          quietHours: { enabled: true, from: "22:00", until: "06:00" },
        }),
      ),
      putSettings: vi.fn().mockResolvedValue(notificationSettings()),
    });
    renderSettings(n);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Use quiet hours" }),
    );
    await waitFor(() =>
      expect(n.putSettings).toHaveBeenCalledWith({
        quietHours: { enabled: false, from: "22:00", until: "06:00" },
        expectedRevision: 2,
      }),
    );
  });

  it("a 409 loads the server's copy and says so", async () => {
    const current = notificationSettings({
      revision: 5,
      channels: { ...notificationSettings().channels, record_hit: "off" },
    });
    const n = fakeNotificationsApi({
      putSettings: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "revision_conflict", current }),
        ),
    });
    renderSettings(n);
    fireEvent.change(await screen.findByLabelText("Workout completed"), {
      target: { value: "push" },
    });
    expect(
      await screen.findByText(
        "Updated on another device. You're seeing the latest.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("New record") as HTMLSelectElement).value,
    ).toBe("off");
  });

  it("a server 400 about quiet hours lands on the field", async () => {
    const n = fakeNotificationsApi({
      settings: vi.fn().mockResolvedValue(
        notificationSettings({
          quietHours: { enabled: true, from: "21:00", until: "07:00" },
        }),
      ),
      putSettings: vi.fn().mockRejectedValue(
        apiError(400, {
          code: "invalid_settings",
          message: "quiet hours from and until must differ",
        }),
      ),
    });
    renderSettings(n);
    const from = await screen.findByLabelText("From");
    fireEvent.change(from, { target: { value: "22:00" } });
    fireEvent.blur(from);
    expect(
      await screen.findByText("Start and end need to be different times."),
    ).toBeTruthy();
  });

  it("other save failures show a banner", async () => {
    const n = fakeNotificationsApi({
      putSettings: vi
        .fn()
        .mockRejectedValueOnce(apiError(0, null, true))
        .mockRejectedValueOnce(apiError(500, null)),
    });
    renderSettings(n);
    fireEvent.change(await screen.findByLabelText("New record"), {
      target: { value: "off" },
    });
    expect(
      await screen.findByText(
        "You're offline. Settings change when you're back online.",
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New record"), {
      target: { value: "off" },
    });
    expect(
      await screen.findByText("We couldn't save that change."),
    ).toBeTruthy();
  });

  it("load errors offer a retry, and offline says so", async () => {
    const settings = vi
      .fn()
      .mockRejectedValueOnce(apiError(500, null))
      .mockResolvedValue(notificationSettings());
    renderSettings(fakeNotificationsApi({ settings }));
    expect(
      await screen.findByText("We couldn't load your notification settings."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("New record")).toBeTruthy();
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing your settings/),
    ).toBeTruthy();
  });
});

// ─── Shell ───────────────────────────────────────────────────────────────────

describe("rail", () => {
  it("knows which place a path is in", () => {
    expect(placeFor("/coach/today")).toBe("today");
    expect(placeFor("/coach/notifications/settings")).toBe("notifications");
    expect(placeFor("/coach/library/forms")).toBe("library");
    expect(placeFor("/coach/clients")).toBe("clients");
  });

  it("links Today and Notifications with their counts", async () => {
    saveSession({
      accessToken: "a.eyJleHAiOjk5OTk5OTk5OTl9.s",
      refreshToken: null,
      expiresAt: 9_999_999_999,
      email: "e@x.co",
    });
    renderCoach(<CoachLayout />, {
      route: "/coach/today",
      path: "/coach/today",
      api: fakeApi(),
      notifications: fakeNotificationsApi({
        today: vi.fn().mockResolvedValue(todayPayload()),
        feed: vi.fn().mockResolvedValue(feedPage()),
      }),
    });
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const today = within(nav).getByRole("link", { name: /Today/ });
    expect(today.getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(today.textContent).toContain("3"));
    const notes = within(nav).getByRole("link", { name: /Notifications/ });
    await waitFor(() => expect(notes.textContent).toContain("3 unread"));
    fireEvent.click(notes);
    await waitFor(() => expect(currentPath()).toBe("/coach/notifications"));
  });
});

// ─── Offline with data on screen ─────────────────────────────────────────────

describe("offline with data already loaded", () => {
  it("Notifications keeps the list and says it's offline", async () => {
    const feed = vi
      .fn()
      .mockResolvedValueOnce(feedPage())
      .mockRejectedValue(apiError(0, null, true));
    const { queryClient } = renderFeed(fakeNotificationsApi({ feed }));
    expect(
      await screen.findByRole("region", { name: "Sam Patel" }),
    ).toBeTruthy();
    await queryClient.refetchQueries();
    expect(
      await screen.findByText(/Offline · showing notifications as of/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Mark all read",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("Today keeps the queue and says it's offline", async () => {
    const today = vi
      .fn()
      .mockResolvedValueOnce(todayPayload())
      .mockRejectedValue(apiError(0, null, true));
    const { queryClient } = renderCoach(<TodayContainer now={() => NOW} />, {
      route: "/coach/today",
      path: "/coach/today",
      api: fakeApi(),
      notifications: fakeNotificationsApi({ today }),
    });
    expect(await screen.findByRole("list", { name: "Queue" })).toBeTruthy();
    await queryClient.refetchQueries();
    expect(
      await screen.findByText(/Offline · showing Today as of/),
    ).toBeTruthy();
  });

  it("settings that can't load offline say so", async () => {
    setOnline(false);
    renderSettings(
      fakeNotificationsApi({
        settings: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(
        "You're offline. Settings load when you're back online.",
      ),
    ).toBeTruthy();
  });

  it("a 409 without the server's copy reloads the settings", async () => {
    const settings = vi
      .fn()
      .mockResolvedValueOnce(notificationSettings())
      .mockResolvedValue(notificationSettings({ revision: 9 }));
    const n = fakeNotificationsApi({
      settings,
      putSettings: vi
        .fn()
        .mockRejectedValue(apiError(409, { code: "revision_conflict" })),
    });
    renderSettings(n);
    fireEvent.change(await screen.findByLabelText("New record"), {
      target: { value: "off" },
    });
    expect(
      await screen.findByText(
        "Updated on another device. You're seeing the latest.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(settings).toHaveBeenCalledTimes(2));
  });
});

describe("Today on the real clock", () => {
  it("leaves Active clients out when the roster can't load", async () => {
    renderCoach(<TodayContainer />, {
      route: "/coach/today",
      path: "/coach/today",
      api: fakeApi({ roster: vi.fn().mockRejectedValue(apiError(500, null)) }),
      notifications: fakeNotificationsApi({
        today: vi.fn().mockResolvedValue(todayPayload()),
      }),
    });
    expect(await screen.findByText("Need you")).toBeTruthy();
    expect(screen.queryByText("Active clients")).toBeNull();
  });
});

// ─── Inspector Brad, #578 ────────────────────────────────────────────────────

describe("Inspector Brad #578", () => {
  it("typing a time saves once, with the final value, when the field is left", async () => {
    const n = fakeNotificationsApi({
      settings: vi.fn().mockResolvedValue(
        notificationSettings({
          quietHours: { enabled: true, from: "21:00", until: "07:00" },
        }),
      ),
      putSettings: vi.fn().mockResolvedValue(
        notificationSettings({
          revision: 3,
          quietHours: { enabled: true, from: "21:30", until: "07:00" },
        }),
      ),
    });
    renderSettings(n);
    const from = (await screen.findByLabelText("From")) as HTMLInputElement;
    fireEvent.change(from, { target: { value: "02:00" } });
    fireEvent.change(from, { target: { value: "21:00" } });
    fireEvent.change(from, { target: { value: "21:30" } });
    expect(n.putSettings).not.toHaveBeenCalled();
    expect(from.disabled).toBe(false);
    expect(from.value).toBe("21:30");
    fireEvent.blur(from);
    await waitFor(() => expect(n.putSettings).toHaveBeenCalledTimes(1));
    expect(n.putSettings).toHaveBeenCalledWith({
      quietHours: { enabled: true, from: "21:30", until: "07:00" },
      expectedRevision: 2,
    });
    // Leaving the field again with nothing changed saves nothing.
    fireEvent.blur(from);
    await waitFor(() => expect(from.value).toBe("21:30"));
    expect(n.putSettings).toHaveBeenCalledTimes(1);
  });

  it("a time field stays editable while a save is in flight", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const n = fakeNotificationsApi({
      settings: vi.fn().mockResolvedValue(
        notificationSettings({
          quietHours: { enabled: true, from: "21:00", until: "07:00" },
        }),
      ),
      putSettings: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    renderSettings(n);
    fireEvent.change(await screen.findByLabelText("New record"), {
      target: { value: "off" },
    });
    await waitFor(() => expect(n.putSettings).toHaveBeenCalledTimes(1));
    const until = screen.getByLabelText("Until") as HTMLInputElement;
    expect(until.disabled).toBe(false);
    fireEvent.change(until, { target: { value: "06:30" } });
    finish(notificationSettings({ revision: 3 }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("New record") as HTMLSelectElement).disabled,
      ).toBe(false),
    );
    // The time typed during the save is still there.
    expect(until.value).toBe("06:30");
  });

  it("two quick changes save in turn with the returned revision, no conflict", async () => {
    const putSettings = vi
      .fn()
      .mockResolvedValueOnce(notificationSettings({ revision: 3 }))
      .mockResolvedValueOnce(notificationSettings({ revision: 4 }));
    renderSettings(fakeNotificationsApi({ putSettings }));
    const record = await screen.findByLabelText("New record");
    const workout = screen.getByLabelText("Workout completed");
    fireEvent.change(record, { target: { value: "off" } });
    fireEvent.change(workout, { target: { value: "push" } });
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(2));
    expect(putSettings.mock.calls[0]![0].expectedRevision).toBe(2);
    expect(putSettings.mock.calls[1]![0].expectedRevision).toBe(3);
    expect(screen.queryByText(/Updated on another device/)).toBeNull();
  });

  it("Mark all read sends nothing when nothing loaded is unread", async () => {
    const n = fakeNotificationsApi({
      feed: vi.fn().mockResolvedValue(
        feedPage({
          data: feedPage().data.map((e) => ({
            ...e,
            readAt: NOW.toISOString(),
          })),
          // Newer events past this page are still unread on the server.
          unreadCount: 4,
        }),
      ),
    });
    renderCoach(<NotificationsContainer />, {
      route: "/coach/notifications",
      path: "/coach/notifications",
      api: fakeApi(),
      notifications: n,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );
    expect(n.markRead).not.toHaveBeenCalled();
  });

  it("when a chip's count drops to 0, Today falls back to All", async () => {
    const n = fakeNotificationsApi({
      today: vi.fn().mockResolvedValue(todayPayload()),
    });
    renderCoach(<TodayContainer now={() => NOW} />, {
      route: "/coach/today",
      path: "/coach/today",
      api: fakeApi(),
      notifications: n,
    });
    fireEvent.click(await screen.findByRole("button", { name: /Flags/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Mark done: Tom Reid/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Flags/ })).toBeNull(),
    );
    expect(screen.queryByText("All clear")).toBeNull();
    const queue = screen.getByRole("list", { name: "Queue" });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
