import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FormEditorContainer } from "../forms/FormEditorContainer";
import { FormsLibraryContainer } from "../forms/FormsLibraryContainer";
import type { CoachForm, FormSchedule } from "../api/types";
import {
  CLIENT_ID,
  FORMS,
  SCHEDULES,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";

const LIB = "/coach/library/forms/:formId?/:action?";
const library = (api = fakeApi(), route = "/coach/library/forms") =>
  renderCoach(<FormsLibraryContainer />, { route, path: LIB, api });

beforeEach(() => setOnline(true));
afterEach(() => {
  cleanup();
  setOnline(true);
});

const weekly = { ...SCHEDULES[0]!, revision: 2 } as FormSchedule;
const join: FormSchedule = {
  id: "s-join",
  formId: "f-goals",
  trigger: "on_join",
  audience: "all_clients",
  weekday: null,
  timeLocal: null,
  dueAfterHours: null,
  reminders: [],
  status: "active",
  revision: 1,
};

describe("Library → Forms (C10a)", () => {
  it("shows the stats strip, forms grouped by when they go out, and the selected form", async () => {
    library(
      fakeApi({ formSchedules: vi.fn().mockResolvedValue([weekly, join]) }),
    );
    expect(await screen.findByRole("heading", { name: "Forms" })).toBeTruthy();
    const strip = screen.getByLabelText("Your forms at a glance");
    expect(within(strip).getByText("86")).toBeTruthy();
    expect(within(strip).getByText("Outstanding")).toBeTruthy();
    const starter = screen.getByRole("region", { name: "Starter forms" });
    expect(
      within(starter).getByText("New client: goals and health"),
    ).toBeTruthy();
    const repeating = screen.getByRole("region", { name: "Repeating" });
    expect(within(repeating).getByText("1 of 2 this week")).toBeTruthy();
    expect(
      within(repeating).getByText(
        "Weekly · Sun 09:00 · 0 clients · 2 reminders",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Not sent yet" })).toBeTruthy();
    // Weekly check-in is selected: done count, schedule and outstanding.
    const panel = screen.getByRole("region", { name: "Weekly check-in" });
    expect(
      within(panel).getByText(
        "done this week · 1 outstanding, due Monday 12:00",
      ),
    ).toBeTruthy();
    expect(within(panel).getByText("Weekly, Sunday 09:00")).toBeTruthy();
    expect(within(panel).getByText("Sunday 18:00 · Monday 09:00")).toBeTruthy();
    expect(within(panel).getByText(/Reminder sent/)).toBeTruthy();
    expect(within(panel).getByText("Not done")).toBeTruthy();
    expect(within(panel).getByText("Done")).toBeTruthy();
  });

  it("templates: an empty state, since none are seeded", async () => {
    const api = fakeApi();
    library(api);
    fireEvent.click(await screen.findByRole("button", { name: "Templates" }));
    expect(await screen.findByText(/No templates yet/)).toBeTruthy();
    expect(api.templates).toHaveBeenCalled();
  });

  it("a template, when there is one, is copied into the library", async () => {
    const api = fakeApi({
      templates: vi
        .fn()
        .mockResolvedValue([
          { ...FORMS[0]!, id: "t1", title: "PAR-Q", templateKey: "parq" },
        ]),
      createFromTemplate: vi
        .fn()
        .mockResolvedValue({ ...FORMS[0]!, id: "copy" }),
    });
    library(api);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Add from templates" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use" }));
    await waitFor(() =>
      expect(currentPath()).toBe("/coach/library/forms/copy/edit"),
    );
    expect(api.createFromTemplate.mock.calls[0]![0]).toBe("parq");
  });

  it("a failed template copy says so", async () => {
    library(
      fakeApi({
        templates: vi
          .fn()
          .mockResolvedValue([
            { ...FORMS[0]!, id: "t1", title: "PAR-Q", templateKey: "parq" },
          ]),
        createFromTemplate: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Templates/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use" }));
    expect(
      await screen.findByText(/Using a template needs a connection/),
    ).toBeTruthy();
  });

  it("New form and + Add open the editor with the cadence", async () => {
    library();
    fireEvent.click(await screen.findByRole("button", { name: "New form" }));
    expect(currentPath()).toBe("/coach/library/forms/new");
    fireEvent.click(
      screen.getByRole("button", { name: "Add a form: Repeating" }),
    );
    expect(currentPath()).toBe("/coach/library/forms/new?when=weekly");
  });

  it("selecting a form, Edit questions and Preview", async () => {
    library();
    fireEvent.click(
      await screen.findByRole("button", { name: /Lifestyle and schedule/ }),
    );
    expect(currentPath()).toBe("/coach/library/forms/f-life");
    const panel = await screen.findByRole("region", {
      name: "Lifestyle and schedule",
    });
    expect(within(panel).getByText(/Not sent yet/)).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Preview as a client" }),
    );
    expect(screen.getByRole("dialog", { name: /Preview/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Edit questions" }),
    );
    expect(currentPath()).toBe("/coach/library/forms/f-life/edit");
  });

  it("See all expands the outstanding list", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      clientId: `c${i}`,
      name: i === 0 ? null : `Client ${i}`,
      requestId: `r${i}`,
      status: i === 1 ? ("missed" as const) : ("pending" as const),
      late: false,
      sentAt: "2026-11-22T09:00:00.000Z",
      dueAt: null,
      completedAt: null,
      remindersSent: 0,
      lastReminderAt: null,
    }));
    library(
      fakeApi({
        formStats: vi.fn().mockResolvedValue({
          forms: [
            {
              formId: "f-weekly",
              reached: 6,
              done: 0,
              outstanding: 6,
              clients: many,
            },
          ],
          totals: {
            forms: 3,
            repeating: 1,
            outstanding: 6,
            onTimeRate: null,
            onTimeSample: 0,
          },
        }),
      }),
    );
    const panel = await screen.findByRole("region", {
      name: "Weekly check-in",
    });
    expect(within(panel).getAllByText(/Sent Sun/)).toHaveLength(4);
    expect(within(panel).getByText("Missed")).toBeTruthy();
    expect(within(panel).getByText("Client")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "See all 6" }));
    expect(within(panel).getAllByText(/Sent Sun/)).toHaveLength(6);
    fireEvent.click(within(panel).getByRole("button", { name: "Show fewer" }));
    // No on-time rate yet: a dash.
    expect(
      within(screen.getByLabelText("Your forms at a glance")).getByText("—"),
    ).toBeTruthy();
  });

  it("can't load: offline says so and retries", async () => {
    setOnline(false);
    const forms = vi.fn().mockRejectedValue(apiError(0, null, true));
    library(fakeApi({ forms }));
    expect(
      await screen.findByText(/Your forms load when you're back online/),
    ).toBeTruthy();
    forms.mockResolvedValue(FORMS);
    setOnline(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Forms" })).toBeTruthy();
  });

  it("offline with forms loaded shows the banner", async () => {
    const { queryClient } = library();
    await screen.findByRole("heading", { name: "Forms" });
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing your forms/),
    ).toBeTruthy();
    queryClient.clear();
  });
});

describe("Send a form (C10c)", () => {
  it("sends a weekly form to chosen clients with a reminder", async () => {
    const api = fakeApi({ createSchedule: vi.fn().mockResolvedValue(weekly) });
    library(api, "/coach/library/forms/f-life/send");
    const dlg = await screen.findByRole("dialog", {
      name: "Send Lifestyle and schedule",
    });
    expect(within(dlg).getByText("9 questions")).toBeTruthy();
    const send = within(dlg).getByRole("button", {
      name: "Send to 0 clients",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Add clients"), {
      target: { value: CLIENT_ID },
    });
    expect(
      within(dlg).getByRole("button", { name: "Remove Sam Patel" }),
    ).toBeTruthy();
    expect(
      within(dlg).getByText(
        "1 client gets it every Sunday at 09:00, due Monday 12:00, with a reminder Sunday 18:00 if it's not done.",
      ),
    ).toBeTruthy();
    // Thursday, add a reminder, change time.
    fireEvent.click(within(dlg).getByRole("button", { name: "Thursday" }));
    fireEvent.change(within(dlg).getByLabelText("Time"), {
      target: { value: "07:30" },
    });
    fireEvent.click(
      within(dlg).getByRole("button", { name: "+ Add reminder" }),
    );
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to 1 client" }),
    );
    await waitFor(() => expect(api.createSchedule).toHaveBeenCalled());
    const [body, key] = api.createSchedule.mock.calls[0]!;
    expect(body).toMatchObject({
      formId: "f-life",
      trigger: "weekly",
      audience: "selected",
      clientIds: [CLIENT_ID],
      weekday: 4,
      timeLocal: "07:30",
    });
    expect(body.reminders).toHaveLength(2);
    expect(typeof key).toBe("string");
    await waitFor(() =>
      expect(currentPath()).toBe("/coach/library/forms/f-life"),
    );
  });

  it("every cadence: join forms go to all clients; once has after-the-send due and reminders", async () => {
    const api = fakeApi({ createSchedule: vi.fn().mockResolvedValue(weekly) });
    library(api, "/coach/library/forms/f-life/send");
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(
      within(dlg).getByRole("button", { name: "When they join" }),
    );
    expect(within(dlg).getByText(/go to every new client/)).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "When coaching ends" }),
    );
    fireEvent.click(within(dlg).getByRole("button", { name: "Daily" }));
    expect(within(dlg).getByText("Send at")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Once" }));
    fireEvent.change(within(dlg).getByLabelText("Due"), {
      target: { value: "48" },
    });
    fireEvent.click(
      within(dlg).getByRole("button", { name: "+ Add reminder" }),
    );
    fireEvent.change(within(dlg).getByLabelText("Reminder 1"), {
      target: { value: "12" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "All clients" }));
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to all clients" }),
    );
    await waitFor(() => expect(api.createSchedule).toHaveBeenCalled());
    expect(api.createSchedule.mock.calls[0]![0]).toEqual({
      formId: "f-life",
      trigger: "once",
      audience: "all_clients",
      weekday: null,
      timeLocal: null,
      dueAfterHours: 48,
      // The weekly default's reminder (9 h) plus the added one (33 h);
      // the first was changed to 12 h after the send.
      reminders: [{ afterHours: 12 }, { afterHours: 33 }],
    });
  });

  it("an error keeps the dialog open; offline says it needs a connection", async () => {
    const api = fakeApi({
      createSchedule: vi
        .fn()
        .mockRejectedValueOnce(apiError(0, null, true))
        .mockRejectedValueOnce(
          apiError(422, {
            code: "invalid_schedule",
            message: "weekly rules need weekday and timeLocal",
          }),
        ),
    });
    library(api, "/coach/library/forms/f-life/send");
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "All clients" }));
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to all clients" }),
    );
    expect(
      await within(dlg).findByText(
        "You're offline. Sending needs a connection.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to all clients" }),
    );
    expect(
      await within(dlg).findByText(/weekly rules need weekday/),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(currentPath()).toBe("/coach/library/forms/f-life");
  });

  it("Change edits the rule with its revision; a 409 shows the latest", async () => {
    const changed = { ...weekly, weekday: 1, revision: 3 };
    const api = fakeApi({
      formSchedules: vi.fn().mockResolvedValue([
        {
          ...weekly,
          clients: [
            {
              clientId: CLIENT_ID,
              relationshipId: "r",
              status: "active",
              override: null,
            },
          ],
        },
      ]),
      patchSchedule: vi
        .fn()
        .mockRejectedValueOnce(
          apiError(409, { code: "revision_conflict", current: changed }),
        )
        .mockResolvedValueOnce(changed),
    });
    library(api);
    const panel = await screen.findByRole("region", {
      name: "Weekly check-in",
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Change" }));
    const dlg = await screen.findByRole("dialog", {
      name: "Change Weekly check-in",
    });
    // Changing a rule keeps its cadence; Sam is already picked.
    expect(within(dlg).getAllByRole("button", { name: "Weekly" })).toHaveLength(
      1,
    );
    expect(
      within(dlg).getByRole("button", { name: "Remove Sam Patel" }),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Edited on another device. You're seeing the latest.",
      ),
    ).toBeTruthy();
    expect(api.patchSchedule.mock.calls[0]![2]).toBe(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("from a client's Check-ins tab: that client is picked and the send returns there", async () => {
    const api = fakeApi({ createSchedule: vi.fn().mockResolvedValue(weekly) });
    library(api, `/coach/library/forms/f-life/send?client=${CLIENT_ID}`);
    const dlg = await screen.findByRole("dialog");
    expect(
      within(dlg).getByRole("button", { name: "Remove Sam Patel" }),
    ).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Remove Sam Patel" }),
    );
    fireEvent.change(within(dlg).getByLabelText("Add clients"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to 1 client" }),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}/check-ins`),
    );
  });
});

// ─── Editor (C10b) ───────────────────────────────────────────────────────────

const EDIT = "/coach/library/forms/:formId/edit";
const NEW = "/coach/library/forms/new";
const editable: CoachForm = {
  ...FORMS[2]!,
  revision: 5,
  version: {
    id: "v3",
    version: 3,
    questions: [
      { id: "w1", type: "scale", prompt: "Energy this week", required: true },
      { id: "w2", type: "short_text", prompt: "Stress", required: false },
    ],
  },
};

describe("Build and edit a form (C10b)", () => {
  it("builds a new form with all 8 question types, then opens Send for its cadence", async () => {
    const api = fakeApi({
      createForm: vi.fn().mockResolvedValue({ ...editable, id: "made" }),
    });
    renderCoach(<FormEditorContainer />, {
      route: `${NEW}?when=weekly`,
      path: NEW,
      api,
    });
    const save = screen.getByRole("button", {
      name: "Save form",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Form name"), {
      target: { value: "Weekly check-in" },
    });
    const types = [
      "Short text",
      "Long text",
      "Number",
      "Scale 1–5",
      "Single choice",
      "Multiple choice",
      "Photo",
      "Yes / no",
    ];
    types.forEach((label, i) => {
      if (i > 0)
        fireEvent.click(screen.getByRole("button", { name: "Add question" }));
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: `Q ${label}` },
      });
      fireEvent.click(screen.getByRole("radio", { name: label }));
    });
    // Yes / no is selected: details if yes, required, help.
    fireEvent.click(
      screen.getByRole("switch", { name: "Ask for details if yes" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Required" }));
    fireEvent.change(screen.getByLabelText("Help text, optional"), {
      target: { value: "Where?" },
    });
    // Number: unit, range and filled for them.
    fireEvent.click(screen.getByRole("button", { name: /Question 3:/ }));
    fireEvent.change(screen.getByLabelText("Unit, optional"), {
      target: { value: "kg" },
    });
    fireEvent.change(screen.getByLabelText("Lowest, optional"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Highest, optional"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Filled for them"), {
      target: { value: "weight" },
    });
    expect(screen.getAllByText("Filled for them").length).toBeGreaterThan(1);
    // Single choice: a third option, then remove it again and edit one.
    fireEvent.click(screen.getByRole("button", { name: /Question 5:/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add option" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 3" }));
    fireEvent.change(screen.getByLabelText("Option 1"), {
      target: { value: "Good" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));
    await waitFor(() => expect(api.createForm).toHaveBeenCalled());
    const [input] = api.createForm.mock.calls[0]!;
    expect(input.title).toBe("Weekly check-in");
    expect(input.questions.map((q: { type: string }) => q.type)).toEqual([
      "short_text",
      "long_text",
      "number",
      "scale",
      "single_choice",
      "multiple_choice",
      "photo",
      "yes_no",
    ]);
    expect(input.questions[2]).toMatchObject({
      unit: "kg",
      min: 30,
      max: 300,
      prefill: "weight",
    });
    expect(input.questions[4].options).toEqual(["Good", "Option 2"]);
    expect(input.questions[7]).toMatchObject({
      detailsIfYes: true,
      required: true,
      help: "Where?",
    });
    await waitFor(() =>
      expect(currentPath()).toBe("/coach/library/forms/made/send?when=weekly"),
    );
  });

  it("a blank question blocks saving and says why", async () => {
    renderCoach(<FormEditorContainer />, {
      route: NEW,
      path: NEW,
      api: fakeApi(),
    });
    fireEvent.change(screen.getByLabelText("Form name"), {
      target: { value: "T" },
    });
    expect(screen.getAllByText("Write the question.").length).toBeGreaterThan(
      0,
    );
    expect(
      (screen.getByRole("button", { name: "Save form" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("duplicate, move and delete questions; preview", async () => {
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/f-weekly/edit",
      path: EDIT,
      api: fakeApi({ forms: vi.fn().mockResolvedValue([editable]) }),
    });
    expect(await screen.findByDisplayValue("Weekly check-in")).toBeTruthy();
    expect(screen.getByText(/2 questions · version 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(
      screen.getAllByRole("button", { name: /Energy this week/ }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    expect(
      screen.getByRole("button", { name: /Question 3: Energy/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getAllByRole("button", { name: /Energy this week/ }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const dlg = screen.getByRole("dialog", {
      name: /Preview · Weekly check-in/,
    });
    expect(within(dlg).getByText("Energy this week *")).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves with the revision; the banner says who gets it and when changes apply", async () => {
    const saved = { ...editable, revision: 6 };
    const api = fakeApi({
      forms: vi.fn().mockResolvedValue([editable]),
      patchForm: vi.fn().mockResolvedValue(saved),
    });
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/f-weekly/edit",
      path: EDIT,
      api,
    });
    expect(await screen.findByText(/2 clients get this form\./)).toBeTruthy();
    expect(screen.getByText(/sent weekly to 2 clients/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Energy, 1 to 5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.patchForm).toHaveBeenCalled());
    const [id, patch, revision] = api.patchForm.mock.calls[0]!;
    expect(id).toBe("f-weekly");
    expect(patch.title).toBeUndefined();
    expect(patch.questions[0].prompt).toBe("Energy, 1 to 5");
    expect(revision).toBe(5);
    await waitFor(() =>
      expect(currentPath()).toBe("/coach/library/forms/f-weekly"),
    );
  });

  it("409: edited on another device — the server copy replaces the draft", async () => {
    const current: CoachForm = {
      ...editable,
      title: "Weekly check-in v2",
      revision: 7,
      version: {
        id: "v4",
        version: 4,
        questions: [{ id: "x", type: "scale", prompt: "Mood", required: true }],
      },
    };
    const api = fakeApi({
      forms: vi.fn().mockResolvedValue([editable]),
      patchForm: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "revision_conflict", current }),
        ),
    });
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/f-weekly/edit",
      path: EDIT,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Form name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Edited on another device. You're seeing the latest.",
      ),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Weekly check-in v2")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Question 1: Mood/ }),
    ).toBeTruthy();
    expect(api.patchForm.mock.calls[0]![1]).toEqual({ title: "Renamed" });
  });

  it("409 without a copy reloads; invalid questions and offline keep the draft", async () => {
    const api = fakeApi({
      forms: vi.fn().mockResolvedValue([editable]),
      patchForm: vi
        .fn()
        .mockRejectedValueOnce(apiError(422, { code: "invalid_questions" }))
        .mockRejectedValueOnce(apiError(0, null, true))
        .mockRejectedValueOnce(apiError(500, { message: "Boom" }))
        .mockRejectedValueOnce(new Error("x"))
        .mockRejectedValueOnce(apiError(409, { code: "revision_conflict" })),
    });
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/f-weekly/edit",
      path: EDIT,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Form name"), {
      target: { value: "Renamed" },
    });
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    save();
    expect(await screen.findByText(/Some questions aren't valid/)).toBeTruthy();
    save();
    expect(
      await screen.findByText(/You're offline. Your changes are still here/),
    ).toBeTruthy();
    save();
    expect(await screen.findByText("Boom")).toBeTruthy();
    save();
    expect(
      await screen.findByText("We couldn't save this form. Try again."),
    ).toBeTruthy();
    save();
    expect(await screen.findByText(/Edited on another device/)).toBeTruthy();
    await waitFor(() => expect(api.forms).toHaveBeenCalledTimes(2));
  });

  it("an unknown form says so; offline too", async () => {
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/nope/edit",
      path: EDIT,
      api: fakeApi(),
    });
    expect(
      await screen.findByText("This form isn't in your library."),
    ).toBeTruthy();
  });

  it("offline and nothing loaded", async () => {
    setOnline(false);
    renderCoach(<FormEditorContainer />, {
      route: "/coach/library/forms/nope/edit",
      path: EDIT,
      api: fakeApi({
        forms: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    });
    expect(
      await screen.findByText(/This form loads when you're back online/),
    ).toBeTruthy();
  });
});

describe("Rule fields: due and reminders as a day and time (C10c)", () => {
  it("weekly: change and remove the due time; move and remove reminders", async () => {
    const api = fakeApi({ createSchedule: vi.fn().mockResolvedValue(weekly) });
    library(api, "/coach/library/forms/f-life/send");
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Due day"), {
      target: { value: "2" },
    });
    fireEvent.change(within(dlg).getByLabelText("Due time"), {
      target: { value: "08:00" },
    });
    expect(within(dlg).getByText(/due Tuesday 08:00/)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Reminder 1 day"), {
      target: { value: "1" },
    });
    fireEvent.change(within(dlg).getByLabelText("Reminder 1 time"), {
      target: { value: "20:00" },
    });
    // An empty time is ignored.
    fireEvent.change(within(dlg).getByLabelText("Reminder 1 time"), {
      target: { value: "" },
    });
    expect(within(dlg).getByText(/a reminder Monday 20:00/)).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Remove reminder Monday 20:00" }),
    );
    // No due time at all, then back.
    fireEvent.click(within(dlg).getByLabelText("Has a due time"));
    expect(within(dlg).queryByLabelText("Due day")).toBeNull();
    fireEvent.click(within(dlg).getByLabelText("Has a due time"));
    expect(within(dlg).getByText(/due Monday 12:00/)).toBeTruthy();
    fireEvent.click(within(dlg).getByLabelText("Has a due time"));
    fireEvent.click(within(dlg).getByRole("button", { name: "All clients" }));
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Send to all clients" }),
    );
    await waitFor(() => expect(api.createSchedule).toHaveBeenCalled());
    expect(api.createSchedule.mock.calls[0]![0]).toMatchObject({
      dueAfterHours: null,
      reminders: [],
    });
  });

  it("daily: due is the same day or next, with a time", async () => {
    library(fakeApi(), "/coach/library/forms/f-life/send?when=daily");
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByLabelText("Due day")).toBeNull();
    fireEvent.click(within(dlg).getByLabelText("Has a due time"));
    expect(within(dlg).getByText(/due Same day at 12:00/)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Due time"), {
      target: { value: "07:00" },
    });
    expect(within(dlg).getByText(/due Next day at 07:00/)).toBeTruthy();
    fireEvent.click(
      within(dlg).getByRole("button", { name: "+ Add reminder" }),
    );
    expect(within(dlg).getByText(/a reminder Same day at 17:00/)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Time"), {
      target: { value: "" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(currentPath()).toBe("/coach/library/forms/f-life");
  });
});
