import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ClientPage } from "../clients/ClientPage";
import {
  CLIENT_FORMS,
  CLIENT_ID,
  RESPONSES,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  response,
  setOnline,
} from "./helpers";

const PATH = "/coach/clients/:clientId/:tab?";
const ROUTE = `/coach/clients/${CLIENT_ID}/check-ins`;
const open = (api = fakeApi()) =>
  renderCoach(<ClientPage />, { route: ROUTE, path: PATH, api });

beforeEach(() => setOnline(true));
afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("Client → Check-ins (C3.3a)", () => {
  it("shows Sent to with last-done pills, History, and Weekly check-in compared with last week", async () => {
    open();
    expect(await screen.findByText("Sent to Sam")).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "Check-ins" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Last done Sun 22 Nov")).toBeTruthy();
    expect(screen.getByText("Not done yet")).toBeTruthy();
    expect(screen.getByText("Every Sun 09:00 · due Mon 12:00")).toBeTruthy();
    expect(screen.getByText("Once · sent Fri 20 Nov")).toBeTruthy();
    // History, newest first, with review state.
    expect(screen.getByText("Weekly · Sun 22 Nov")).toBeTruthy();
    expect(screen.getByText("New · 3 answers")).toBeTruthy();
    expect(screen.getByText("Reviewed · you replied")).toBeTruthy();
    // The comparison: latest vs the week before.
    const cmp = screen.getByRole("region", { name: "Weekly check-in" });
    expect(within(cmp).getByText("Sun 22 Nov · latest")).toBeTruthy();
    expect(within(cmp).getByText("4 / 5")).toBeTruthy();
    expect(within(cmp).getByText("3 / 5")).toBeTruthy();
    expect(within(cmp).getByText("up from before")).toBeTruthy();
    expect(within(cmp).getByText("down from before")).toBeTruthy();
    expect(within(cmp).getByText("“Work deadline”")).toBeTruthy();
    expect(
      (within(cmp).getByLabelText("Compare with") as HTMLSelectElement).value,
    ).toBe("resp-0");
  });

  it("compare with any earlier check-in from the dropdown", async () => {
    const third = response({
      id: "resp-old",
      submittedAt: "2026-11-08T10:00:00.000Z",
      answers: { w1: 2, w2: 8, w3: "Calm" },
      reviewedAt: "x",
    });
    open(
      fakeApi({
        responses: vi
          .fn()
          .mockResolvedValue({ data: [...RESPONSES, third], nextCursor: null }),
      }),
    );
    const select = (await screen.findByLabelText(
      "Compare with",
    )) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      "Sun 15 Nov",
      "Sun 8 Nov",
    ]);
    fireEvent.change(select, { target: { value: "resp-old" } });
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(screen.getByText("“Calm”")).toBeTruthy();
  });

  it("History: showing an older one compares it with the one before it", async () => {
    open();
    fireEvent.click(
      await screen.findByRole("button", { name: /Reviewed · you replied/ }),
    );
    const cmp = screen.getByRole("region", { name: "Weekly check-in" });
    expect(within(cmp).getByText("No earlier one")).toBeTruthy();
    expect(within(cmp).getByText("Nice week")).toBeTruthy();
    expect(within(cmp).getByText("Reviewed")).toBeTruthy();
    expect(
      within(cmp).getByRole("button", { name: "Change reply" }),
    ).toBeTruthy();
    expect(
      within(cmp).queryByRole("button", { name: "Mark reviewed" }),
    ).toBeNull();
  });

  it("Mark reviewed, and Review and reply", async () => {
    const reviewResponse = vi
      .fn()
      .mockResolvedValueOnce(response({ reviewedAt: "2026-11-23T08:00:00Z" }))
      .mockResolvedValueOnce(
        response({
          reviewedAt: "2026-11-23T08:00:00Z",
          replyText: "Great work",
        }),
      );
    open(fakeApi({ reviewResponse }));
    const cmp = await screen.findByRole("region", { name: "Weekly check-in" });
    fireEvent.click(within(cmp).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() =>
      expect(reviewResponse).toHaveBeenCalledWith(
        CLIENT_ID,
        "resp-1",
        undefined,
      ),
    );
    expect(await within(cmp).findByText("Reviewed")).toBeTruthy();
    fireEvent.click(
      within(cmp).getByRole("button", { name: "Review and reply" }),
    );
    fireEvent.change(within(cmp).getByLabelText("Reply to Sam"), {
      target: { value: "  Great work  " },
    });
    fireEvent.click(
      within(cmp).getByRole("button", { name: "Send reply and mark reviewed" }),
    );
    await waitFor(() =>
      expect(reviewResponse).toHaveBeenLastCalledWith(
        CLIENT_ID,
        "resp-1",
        "Great work",
      ),
    );
    expect(await within(cmp).findByText("Great work")).toBeTruthy();
  });

  it("offline: the reply stays and it says why; Cancel closes the reply box", async () => {
    open(
      fakeApi({
        reviewResponse: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    const cmp = await screen.findByRole("region", { name: "Weekly check-in" });
    fireEvent.click(
      within(cmp).getByRole("button", { name: "Review and reply" }),
    );
    fireEvent.change(within(cmp).getByLabelText("Reply to Sam"), {
      target: { value: "Hi" },
    });
    fireEvent.click(
      within(cmp).getByRole("button", { name: "Send reply and mark reviewed" }),
    );
    expect(
      await screen.findByText(
        /Reviewing needs a connection; your reply is still here/,
      ),
    ).toBeTruthy();
    expect(
      (within(cmp).getByLabelText("Reply to Sam") as HTMLTextAreaElement).value,
    ).toBe("Hi");
    fireEvent.click(within(cmp).getByRole("button", { name: "Cancel" }));
    expect(within(cmp).queryByLabelText("Reply to Sam")).toBeNull();
  });

  it("other review errors", async () => {
    open(
      fakeApi({
        reviewResponse: vi
          .fn()
          .mockRejectedValueOnce(
            apiError(404, { message: "Response not found" }),
          )
          .mockRejectedValueOnce(new Error("x")),
      }),
    );
    const cmp = await screen.findByRole("region", { name: "Weekly check-in" });
    fireEvent.click(within(cmp).getByRole("button", { name: "Mark reviewed" }));
    expect(await screen.findByText("Response not found")).toBeTruthy();
    fireEvent.click(within(cmp).getByRole("button", { name: "Mark reviewed" }));
    expect(
      await screen.findByText("We couldn't save that. Try again."),
    ).toBeTruthy();
  });

  it("offline with check-ins loaded shows the banner; nothing loaded says so", async () => {
    const { queryClient } = open();
    await screen.findByText("Sent to Sam");
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing Sam's check-ins/),
    ).toBeTruthy();
    queryClient.clear();
    cleanup();
    open(
      fakeApi({
        clientForms: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(/Sam's check-ins load when you're back online/),
    ).toBeTruthy();
    cleanup();
    setOnline(true);
    const clientForms = vi.fn().mockRejectedValueOnce(apiError(500, null));
    clientForms.mockResolvedValue(CLIENT_FORMS);
    open(fakeApi({ clientForms }));
    expect(
      await screen.findByText("We couldn't load Sam's check-ins."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Sent to Sam")).toBeTruthy();
  });

  it("no forms and no answers yet", async () => {
    open(
      fakeApi({
        clientForms: vi.fn().mockResolvedValue([]),
        responses: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      }),
    );
    expect(await screen.findByText(/No forms sent to Sam yet/)).toBeTruthy();
    expect(screen.getByText("Nothing answered yet.")).toBeTruthy();
    expect(
      screen.getByText("Pick a form or a check-in to see the answers."),
    ).toBeTruthy();
  });

  it("+ Add form picks a library form and opens Send for this client", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "+ Add form" }));
    const dlg = await screen.findByRole("dialog", {
      name: "Send a form to Sam",
    });
    // Already sent: Weekly check-in and the once form (f-goals).
    expect(within(dlg).queryByText("Weekly check-in")).toBeNull();
    fireEvent.click(
      within(dlg).getByRole("button", { name: /Lifestyle and schedule/ }),
    );
    expect(currentPath()).toBe(
      `/coach/library/forms/f-life/send?client=${CLIENT_ID}`,
    );
  });

  it("+ Add form with nothing left to add, and Close", async () => {
    open(fakeApi({ forms: vi.fn().mockResolvedValue([]) }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add form" }));
    const dlg = await screen.findByRole("dialog");
    expect(
      within(dlg).getByText(/already goes to Sam, or your library is empty/),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Settings tab is still there, and an unknown tab goes to Settings", async () => {
    open();
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}/settings`);
  });
});

describe("Set it up for one client (C10j)", () => {
  const panelFor = async (name: RegExp) => {
    fireEvent.click(await screen.findByRole("button", { name }));
    return screen.findByRole("dialog", { name: /for Sam only/ });
  };

  it("a different cadence for Sam only: daily at 07:00", async () => {
    const updated = {
      ...CLIENT_FORMS[0]!,
      rule: {
        ...CLIENT_FORMS[0]!.rule!,
        override: { trigger: "daily" as const, timeLocal: "07:00" },
      },
    };
    const api = fakeApi({
      clientFormSetup: vi.fn().mockResolvedValue(updated),
    });
    open(api);
    const panel = await panelFor(/Weekly check-in: set up for Sam/);
    expect(within(panel).getByText("Last done Sun 22 Nov")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Daily" }));
    fireEvent.change(within(panel).getByLabelText("Time"), {
      target: { value: "07:00" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.clientFormSetup).toHaveBeenCalled());
    const [clientId, formId, input] = api.clientFormSetup.mock.calls[0]!;
    expect([clientId, formId]).toEqual([CLIENT_ID, "f-weekly"]);
    expect(input).toEqual({
      status: "active",
      scheduleId: "s-weekly",
      override: { trigger: "daily", weekday: null, timeLocal: "07:00" },
    });
    expect(
      await screen.findByText("Weekly check-in is set up for Sam."),
    ).toBeTruthy();
    expect(screen.getByText("Daily 07:00")).toBeTruthy();
  });

  it("Pause, then Resume", async () => {
    const paused = {
      ...CLIENT_FORMS[0]!,
      state: "paused" as const,
      rule: { ...CLIENT_FORMS[0]!.rule!, clientStatus: "paused" },
    };
    const api = fakeApi({
      clientFormSetup: vi
        .fn()
        .mockResolvedValueOnce(paused)
        .mockResolvedValueOnce(CLIENT_FORMS[0]),
    });
    open(api);
    let panel = await panelFor(/Weekly check-in: set up/);
    fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));
    expect(
      await screen.findByText("Weekly check-in is paused for Sam."),
    ).toBeTruthy();
    expect(api.clientFormSetup.mock.calls[0]![2]).toEqual({
      status: "paused",
      scheduleId: "s-weekly",
    });
    expect(screen.getByText("Paused")).toBeTruthy();
    panel = await panelFor(/Weekly check-in: set up/);
    fireEvent.click(within(panel).getByRole("button", { name: "Resume" }));
    expect(
      await screen.findByText("Weekly check-in is back on for Sam."),
    ).toBeTruthy();
    expect(api.clientFormSetup.mock.calls[1]![2]).toEqual({
      status: "active",
      scheduleId: "s-weekly",
    });
  });

  it("Stop asks first, then removes the form for Sam", async () => {
    const api = fakeApi({ clientFormSetup: vi.fn().mockResolvedValue(null) });
    open(api);
    const panel = await panelFor(/Progress review: set up/);
    // A once form: due and reminders are "after it's sent".
    expect(within(panel).getByLabelText("Due")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Stop" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Keep it" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Stop" }));
    expect(
      within(panel).getByText(/Stop sending Progress review to Sam\?/),
    ).toBeTruthy();
    fireEvent.click(within(panel).getAllByRole("button", { name: "Stop" })[0]!);
    expect(
      await screen.findByText("Progress review is stopped for Sam."),
    ).toBeTruthy();
    expect(api.clientFormSetup.mock.calls[0]![2]).toEqual({
      status: "excluded",
    });
    expect(
      screen.queryByRole("button", { name: /Progress review: set up/ }),
    ).toBeNull();
  });

  it("offline: says it needs a connection and keeps the panel; Escape closes", async () => {
    open(
      fakeApi({
        clientFormSetup: vi
          .fn()
          .mockRejectedValueOnce(apiError(0, null, true))
          .mockRejectedValueOnce(
            apiError(422, { message: "weekday must be 1 (Mon) to 7 (Sun)" }),
          )
          .mockRejectedValueOnce(new Error("x")),
      }),
    );
    const panel = await panelFor(/Weekly check-in: set up/);
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(
      await within(panel).findByText(
        /Changes for one client need a connection/,
      ),
    ).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(await within(panel).findByText(/weekday must be/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(
      await within(panel).findByText("We couldn't save that. Try again."),
    ).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /for Sam only/ })).toBeNull();
  });

  it("a join form keeps its cadence; a form with no live rule has nothing to set", async () => {
    open(
      fakeApi({
        clientForms: vi.fn().mockResolvedValue([
          {
            ...CLIENT_FORMS[1]!,
            form: { id: "f-j", title: "Goals", archivedAt: null },
            rule: { ...CLIENT_FORMS[1]!.rule!, trigger: "on_join" },
          },
          {
            ...CLIENT_FORMS[1]!,
            form: { id: "f-x", title: "Old form", archivedAt: null },
            rule: null,
          },
        ]),
      }),
    );
    let panel = await panelFor(/Goals: set up/);
    expect(
      within(panel).getAllByRole("button", { name: "When they join" }),
    ).toHaveLength(1);
    expect(within(panel).queryByRole("button", { name: "Weekly" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    panel = await panelFor(/Old form: set up/);
    // No live rule: nothing to set up, so no Pause, Stop or Save.
    expect(within(panel).getByText(/no live send rule/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText(/Old form: no answers from Sam yet/)).toBeTruthy();
  });
});

describe("Inspector Brad #555: one rule at a time", () => {
  it("save changes only the rule being edited; pause and stop cover every rule", async () => {
    const entry = {
      ...CLIENT_FORMS[0]!,
      rules: [
        CLIENT_FORMS[0]!.rule!,
        { ...CLIENT_FORMS[1]!.rule!, scheduleId: "s-join", trigger: "on_join" },
      ],
    };
    const api = fakeApi({
      clientForms: vi.fn().mockResolvedValue([entry]),
      clientFormSetup: vi.fn().mockResolvedValue(entry),
    });
    renderCoach(<ClientPage />, { route: ROUTE, path: PATH, api });
    const open = async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /Weekly check-in: set up/ }),
      );
      return screen.findByRole("dialog", { name: /for Sam only/ });
    };
    let panel = await open();
    fireEvent.click(within(panel).getByRole("button", { name: "Wednesday" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.clientFormSetup).toHaveBeenCalledTimes(1));
    expect(api.clientFormSetup.mock.calls[0]![2]).toEqual({
      status: "active",
      scheduleId: "s-weekly",
      override: { weekday: 3 },
    });
    panel = await open();
    fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(api.clientFormSetup).toHaveBeenCalledTimes(3));
    // Pause covers every rule that reaches Sam, one rule at a time, so no
    // rule he isn't on gains a target (Inspector Brad, #555 sweep 3).
    expect(api.clientFormSetup.mock.calls.slice(1, 3).map((c) => c[2])).toEqual(
      [
        { status: "paused", scheduleId: "s-weekly" },
        { status: "paused", scheduleId: "s-join" },
      ],
    );
    panel = await open();
    fireEvent.click(within(panel).getByRole("button", { name: "Stop" }));
    fireEvent.click(within(panel).getAllByRole("button", { name: "Stop" })[0]!);
    await waitFor(() => expect(api.clientFormSetup).toHaveBeenCalledTimes(4));
    expect(api.clientFormSetup.mock.calls[3]![2]).toEqual({
      status: "excluded",
    });
  });
});

describe("Inspector Brad #555 sweep 2: the client's own pause", () => {
  it("a rule paused for everyone isn't saved as a pause for this client", async () => {
    const entry = {
      ...CLIENT_FORMS[0]!,
      state: "paused" as const,
      rule: { ...CLIENT_FORMS[0]!.rule!, status: "paused", clientStatus: null },
    };
    const api = fakeApi({
      clientForms: vi.fn().mockResolvedValue([entry]),
      clientFormSetup: vi.fn().mockResolvedValue(entry),
    });
    renderCoach(<ClientPage />, { route: ROUTE, path: PATH, api });
    fireEvent.click(
      await screen.findByRole("button", { name: /Weekly check-in: set up/ }),
    );
    const panel = await screen.findByRole("dialog", { name: /for Sam only/ });
    // Not paused for Sam: the panel offers Pause, not Resume.
    expect(within(panel).getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Resume" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.clientFormSetup).toHaveBeenCalled());
    expect(api.clientFormSetup.mock.calls[0]![2].status).toBe("active");
  });
});
