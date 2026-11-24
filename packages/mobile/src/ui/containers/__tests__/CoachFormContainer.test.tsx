import { fireEvent, waitFor } from "@testing-library/react-native";
import {
  CoachFormContainer,
  canSendSheet,
  initialSheet,
  outstandingRow,
} from "@/ui/containers/CoachFormContainer";
import { defaultRule } from "@/domain/services/coachForms.service";
import type { TrainerClient } from "@/domain/models/trainerClient";
import {
  COACH,
  makeForm,
  makeSchedule,
  setupCoachForms,
} from "./coachFormsTestKit";

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const client = (id: string, name: string): TrainerClient =>
  ({
    id,
    name,
    initials: name
      .split(" ")
      .map((p) => p[0])
      .join(""),
    avatarUrl: null,
    status: "active",
  }) as TrainerClient;

function seed(h: ReturnType<typeof setupCoachForms>) {
  h.storage.cacheCoachForms(COACH, {
    forms: [makeForm("f-week", "Weekly check-in")],
    templates: [],
    asOf: "a",
  });
  h.storage.cacheCoachFormSchedules(COACH, [
    makeSchedule("s1", "f-week", "weekly"),
  ]);
  h.storage.cacheCoachFormStats(COACH, {
    forms: [
      {
        formId: "f-week",
        reached: 2,
        done: 1,
        outstanding: 1,
        clients: [
          {
            clientId: "c1",
            name: "Sam Patel",
            requestId: "rq1",
            status: "pending",
            late: false,
            sentAt: "2026-11-23T09:00:00Z",
            dueAt: null,
            completedAt: null,
            remindersSent: 1,
            lastReminderAt: "2026-11-23T18:00:00",
          },
          {
            clientId: "c2",
            name: "Priya Shah",
            requestId: "rq2",
            status: "done",
            late: true,
            sentAt: "2026-11-23T09:00:00Z",
            dueAt: null,
            completedAt: "2026-11-23T20:00:00",
            remindersSent: 0,
            lastReminderAt: null,
          },
        ],
      },
    ],
    totals: {
      forms: 1,
      repeating: 1,
      outstanding: 1,
      onTimeRate: null,
      onTimeSample: 0,
    },
    asOf: "a",
  });
  h.storage.cacheTrainerClients(COACH, [
    client("c1", "Sam Patel"),
    client("c2", "Priya Shah"),
  ]);
  // The server says the same, so a background read changes nothing.
  h.api.coachFormsLibrary = h.storage.getCachedCoachForms(COACH)!;
  h.api.coachFormSchedules = h.storage.getCachedCoachFormSchedules(COACH)!;
  h.api.coachFormStats = h.storage.getCachedCoachFormStats(COACH)!;
  h.api.trainerClients = h.storage.getCachedTrainerClients(COACH)!;
}

beforeEach(() => {
  mockParams = { id: "f-week" };
  Object.values(mockRouter).forEach((f) => f.mockClear());
});

describe("CoachFormContainer (form page + C10h send sheet)", () => {
  it("shows the form, its rule and who still owes it this round", () => {
    const h = setupCoachForms({ online: false });
    seed(h);
    const view = h.render(<CoachFormContainer />);
    expect(view.getByTestId("form-page-title").props.children).toBe(
      "Weekly check-in",
    );
    expect(view.getByText("1 question")).toBeTruthy();
    expect(view.getByText("Sun 09:00 · 2 clients")).toBeTruthy();
    expect(view.getByText("Reminder sent 18:00")).toBeTruthy();
    expect(view.getByText("Not done")).toBeTruthy();
    expect(view.getByText("Done Mon 23 Nov · late")).toBeTruthy();
    fireEvent.press(view.getByTestId("form-page-edit"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/(app)/coach-forms/edit",
      params: { id: "f-week" },
    });
    fireEvent.press(view.getByTestId("form-page-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("sends to chosen clients offline: one keyed POST queued, Send to N clients", async () => {
    const h = setupCoachForms({ online: false });
    seed(h);
    h.server.offline = true;
    const view = h.render(<CoachFormContainer />);
    fireEvent.press(view.getByTestId("form-page-send"));
    expect(view.getByText("Send Weekly check-in")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByTestId("send-form-offline")).toBeTruthy(),
    );
    // Nobody chosen yet.
    expect(
      view.getByTestId("send-form-submit").props.accessibilityState,
    ).toMatchObject({
      disabled: true,
    });
    fireEvent.press(view.getByTestId("send-form-choose"));
    await waitFor(() =>
      expect(view.getByTestId("send-form-client-c1")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("send-form-client-c1"));
    fireEvent.press(view.getByTestId("send-form-client-c2"));
    fireEvent.press(view.getByTestId("send-form-client-c2"));
    expect(view.getByText("Send to 1 client")).toBeTruthy();
    // Canvas defaults: Weekly, Sun 09:00, due Mon 12:00, two reminders.
    expect(view.getByLabelText("When: Weekly")).toBeTruthy();
    expect(view.getByText("Mon 12:00")).toBeTruthy();
    expect(view.getByText("Sunday 18:00")).toBeTruthy();
    expect(view.getByText("Monday 09:00")).toBeTruthy();
    fireEvent.press(view.getByTestId("send-form-submit"));
    await waitFor(() =>
      expect(
        h.storage
          .getUncompletedMutations()
          .filter((e) => e.entityType === "coach_form_schedule"),
      ).toHaveLength(1),
    );
    const entry = h.storage.getUncompletedMutations().at(-1)!;
    expect(entry.method).toBe("POST");
    expect(entry.idempotencyKey).toBeTruthy();
    expect(JSON.parse(entry.payload)).toMatchObject({
      formId: "f-week",
      trigger: "weekly",
      audience: "selected",
      clientIds: ["c1"],
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
    });
    expect(h.storage.getCachedCoachFormSchedules(COACH)).toHaveLength(2);
  });

  it("all clients + a new cadence: counts every active client", async () => {
    const h = setupCoachForms();
    seed(h);
    const view = h.render(<CoachFormContainer />);
    fireEvent.press(view.getByTestId("form-page-send"));
    fireEvent.press(view.getByTestId("send-form-who-all_clients"));
    await waitFor(() =>
      expect(view.getByText("Send to 2 clients")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("send-form-when"));
    fireEvent.press(view.getByTestId("send-form-when-on_join"));
    expect(view.getByText("When they join")).toBeTruthy();
    expect(view.queryByTestId("send-form-rule-day")).toBeNull();
    expect(view.queryByTestId("send-form-rule-time")).toBeNull();
    fireEvent.press(view.getByTestId("send-form-submit"));
    await waitFor(() =>
      expect(
        h.server.calls.find((c) => c.url.endsWith("/form-schedules")),
      ).toBeTruthy(),
    );
    const post = h.server.calls.find((c) => c.url.endsWith("/form-schedules"))!;
    expect(post.body).toMatchObject({
      trigger: "on_join",
      audience: "all_clients",
      weekday: null,
      timeLocal: null,
    });
    expect(post.body.clientIds).toBeUndefined();
  });

  it("changing a live rule PATCHes it with its revision", async () => {
    const h = setupCoachForms();
    seed(h);
    const view = h.render(<CoachFormContainer />);
    fireEvent.press(view.getByTestId("form-page-rule-s1"));
    expect(view.getByText("Save")).toBeTruthy();
    fireEvent.press(view.getByTestId("send-form-rule-day-1"));
    fireEvent.press(view.getByTestId("send-form-submit"));
    await waitFor(() =>
      expect(h.server.calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    const patch = h.server.calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toMatch(/\/trainers\/me\/form-schedules\/s1$/);
    expect(patch.body).toMatchObject({ weekday: 1, expectedRevision: 4 });
  });

  it("a 409 on the rule shows Edited on another device with the server copy", async () => {
    const h = setupCoachForms();
    seed(h);
    h.server.nextStatus = 409;
    h.server.nextBody = {
      code: "revision_conflict",
      current: makeSchedule("s1", "f-week", "weekly", {
        revision: 9,
        timeLocal: "07:00",
      }),
    };
    const view = h.render(<CoachFormContainer />);
    fireEvent.press(view.getByTestId("form-page-rule-s1"));
    fireEvent.press(view.getByTestId("send-form-submit"));
    await waitFor(() =>
      expect(view.getByTestId("form-page-conflict")).toBeTruthy(),
    );
    expect(view.getByText("Edited on another device")).toBeTruthy();
    expect(h.storage.getCachedCoachFormSchedules(COACH)![0]).toMatchObject({
      revision: 9,
      timeLocal: "07:00",
    });
    expect(h.storage.getUncompletedMutations()).toHaveLength(0);
    fireEvent.press(view.getByTestId("form-page-rule-s1"));
    expect(view.getByTestId("send-form-conflict")).toBeTruthy();
    fireEvent.press(view.getByTestId("send-form-conflict-dismiss"));
    await waitFor(() =>
      expect(view.queryByTestId("send-form-conflict")).toBeNull(),
    );
    expect(h.storage.getCoachFormConflicts(COACH)).toEqual([]);
  });

  it("opens the sheet from a deep link with the client chosen (C3.3b + Add)", async () => {
    const h = setupCoachForms();
    seed(h);
    mockParams = { id: "f-week", send: "1", sendTo: "c2", trigger: "daily" };
    const view = h.render(<CoachFormContainer />);
    await waitFor(() =>
      expect(view.getByText("Send to 1 client")).toBeTruthy(),
    );
    expect(view.getByText("Daily")).toBeTruthy();
    fireEvent.press(view.getByTestId("send-form-who-selected"));
    expect(view.getByText("1 client")).toBeTruthy();
  });

  it("Inspector Brad #556: When they join goes to all clients, never Select clients", async () => {
    const h = setupCoachForms();
    seed(h);
    const view = h.render(<CoachFormContainer />);
    fireEvent.press(view.getByTestId("form-page-send"));
    // Starts on Select clients; switching When to join moves Who to All.
    fireEvent.press(view.getByTestId("send-form-when"));
    fireEvent.press(view.getByTestId("send-form-when-on_join"));
    expect(
      view.getByTestId("send-form-who-all_clients").props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      view.getByTestId("send-form-who-selected").props.accessibilityState,
    ).toMatchObject({ selected: false, disabled: true });
    expect(
      view.getByText("Forms for when they join go to every new client."),
    ).toBeTruthy();
    // Select clients can't be chosen back.
    fireEvent.press(view.getByTestId("send-form-who-selected"));
    expect(
      view.getByTestId("send-form-who-all_clients").props.accessibilityState,
    ).toMatchObject({ selected: true });
    await waitFor(() =>
      expect(view.getByText("Send to 2 clients")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("send-form-submit"));
    await waitFor(() =>
      expect(
        h.server.calls.find((c) => c.url.endsWith("/form-schedules")),
      ).toBeTruthy(),
    );
    const post = h.server.calls.find((c) => c.url.endsWith("/form-schedules"))!;
    expect(post.body).toMatchObject({
      trigger: "on_join",
      audience: "all_clients",
    });
    expect(post.body.clientIds).toBeUndefined();
  });

  it("Inspector Brad #556: a join deep link opens on All clients", async () => {
    const h = setupCoachForms();
    seed(h);
    mockParams = { id: "f-week", send: "1", sendTo: "c2", trigger: "on_join" };
    const view = h.render(<CoachFormContainer />);
    await waitFor(() =>
      expect(view.getByText("Send to 2 clients")).toBeTruthy(),
    );
  });

  it("says when the form isn't in the library", () => {
    const h = setupCoachForms();
    h.storage.cacheCoachForms(COACH, { forms: [], templates: [], asOf: "a" });
    mockParams = { id: "nope" };
    const view = h.render(<CoachFormContainer />);
    expect(view.getByTestId("form-page-missing")).toBeTruthy();
  });
});

describe("send sheet rules", () => {
  it("starts from a live rule or the canvas defaults", () => {
    const s = makeSchedule("s1", "f", "weekly", {
      audience: "selected",
      clients: [
        {
          clientId: "a",
          relationshipId: "r",
          status: "active",
          override: null,
        },
        {
          clientId: "b",
          relationshipId: "r",
          status: "excluded",
          override: null,
        },
      ],
    });
    expect(initialSheet(s)).toMatchObject({
      scheduleId: "s1",
      selectedIds: ["a"],
      trigger: "weekly",
    });
    expect(initialSheet(null)).toEqual({
      scheduleId: null,
      audience: "selected",
      selectedIds: [],
      trigger: "weekly",
      rule: defaultRule("weekly"),
    });
  });

  it("needs someone to send to and a complete rule", () => {
    const base = initialSheet(null, { sendTo: "a" });
    expect(canSendSheet(base)).toBe(true);
    expect(canSendSheet({ ...base, selectedIds: [] })).toBe(false);
    expect(
      canSendSheet({ ...base, rule: { ...base.rule, weekday: null } }),
    ).toBe(false);
    expect(
      canSendSheet({
        ...base,
        trigger: "daily",
        rule: { ...base.rule, timeLocal: null },
      }),
    ).toBe(false);
    expect(canSendSheet({ ...base, trigger: "once" })).toBe(true);
    // Inspector Brad #556: the server rejects join rules for chosen clients.
    expect(canSendSheet({ ...base, trigger: "on_join" })).toBe(false);
    expect(
      canSendSheet({ ...base, trigger: "on_join", audience: "all_clients" }),
    ).toBe(true);
    expect(initialSheet(null, { trigger: "on_join" }).audience).toBe(
      "all_clients",
    );
    expect(
      initialSheet(makeSchedule("s2", "f", "on_join", { audience: "selected" }))
        .audience,
    ).toBe("all_clients");
  });

  it("outstanding rows: done, missed, not done", () => {
    const c = {
      clientId: "c",
      name: null,
      requestId: "r",
      status: "missed" as const,
      late: false,
      sentAt: "x",
      dueAt: null,
      completedAt: null,
      remindersSent: 0,
      lastReminderAt: null,
    };
    expect(outstandingRow(c)).toMatchObject({
      name: "Client",
      detail: "Not done",
      pill: { text: "Missed" },
    });
    expect(outstandingRow({ ...c, status: "done" }).detail).toBe("Done");
  });
});
