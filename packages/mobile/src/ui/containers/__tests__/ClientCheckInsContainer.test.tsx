import { fireEvent, waitFor } from "@testing-library/react-native";
import {
  ClientCheckInsContainer,
  initialSetup,
  setupSaveInput,
} from "@/ui/containers/ClientCheckInsContainer";
import { FormResponseContainer } from "@/ui/containers/FormResponseContainer";
import {
  COACH,
  makeClientForm,
  makeForm,
  makeResponse,
  setupCoachForms,
} from "./coachFormsTestKit";

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockParams = {};
  Object.values(mockRouter).forEach((f) => f.mockClear());
});

const LATEST = makeResponse("r2", "2026-10-25T10:14:00", {
  energy: 4,
  sleep: 6.5,
  stress: "Work deadline",
});
const EARLIER = makeResponse(
  "r1",
  "2026-10-18T10:00:00",
  { energy: 3, sleep: 7, stress: "Fine" },
  { reviewedAt: "2026-10-19T09:00:00Z", replyText: "Nice" },
);
const OLDEST = makeResponse(
  "r0",
  "2026-10-11T10:00:00",
  { energy: 2, sleep: 8 },
  { reviewedAt: "2026-10-12T09:00:00Z" },
);

function seed(h: ReturnType<typeof setupCoachForms>) {
  const forms = [
    makeClientForm("f-week", "Weekly check-in", "done"),
    makeClientForm("f-once", "Progress review", "notDoneYet", "once"),
    makeClientForm("f-join", "Goals and health", "paused", "on_join"),
  ];
  h.storage.cacheCoachClientForms(COACH, "c1", forms);
  h.storage.cacheCoachFormResponses(COACH, "c1", [LATEST, EARLIER, OLDEST]);
  h.api.coachClientForms.c1 = forms;
  h.api.coachFormResponses.c1 = [LATEST, EARLIER, OLDEST];
}

const queued = (h: ReturnType<typeof setupCoachForms>) =>
  h.storage.getUncompletedMutations();

describe("ClientCheckInsContainer (C3.3b)", () => {
  it("latest first, then History with review state, then Sent to with pills", async () => {
    const h = setupCoachForms({ online: false });
    seed(h);
    h.api.shouldFail = true;
    const view = h.render(
      <ClientCheckInsContainer clientId="c1" clientName="Sam Patel" />,
    );
    expect(view.getByText("New · Sun 25 Oct")).toBeTruthy();
    expect(view.getByTestId("checkins-latest-summary").props.children).toBe(
      "Energy 4/5 ↑ · sleep 6.5 h ↓",
    );
    expect(view.getByText("Weekly · Sun 25 Oct")).toBeTruthy();
    expect(view.getByText("New · 3 answers")).toBeTruthy();
    expect(view.getByText("To review")).toBeTruthy();
    expect(view.getByText("Reviewed · you replied")).toBeTruthy();
    expect(view.getByText("Sent to Sam")).toBeTruthy();
    expect(view.getByText("Last done Sun 25 Oct")).toBeTruthy();
    expect(view.getByText("Not done yet")).toBeTruthy();
    expect(view.getByText("Paused")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByTestId("checkins-offline")).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId("checkins-review"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]/responses/[responseId]",
      params: { id: "c1", responseId: "r2", name: "Sam Patel" },
    });
    fireEvent.press(view.getByTestId("checkins-history-r1"));
    expect(mockRouter.push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ responseId: "r1" }),
      }),
    );
  });

  it("empty states before anything is sent", async () => {
    const h = setupCoachForms();
    const view = h.render(
      <ClientCheckInsContainer clientId="c9" clientName={null} />,
    );
    await waitFor(() =>
      expect(view.getByTestId("checkins-history-empty")).toBeTruthy(),
    );
    expect(view.getByTestId("checkins-sentto-empty")).toBeTruthy();
    expect(view.getByText("Sent to this client")).toBeTruthy();
    expect(view.queryByTestId("checkins-latest")).toBeNull();
  });

  it("C10j: pause, resume and stop queue a PUT for this client", async () => {
    const h = setupCoachForms({ online: false });
    seed(h);
    h.server.offline = true;
    const view = h.render(
      <ClientCheckInsContainer clientId="c1" clientName="Sam Patel" />,
    );
    fireEvent.press(view.getByTestId("checkins-sentto-f-week"));
    expect(view.getByText("For Sam only")).toBeTruthy();
    expect(view.getByTestId("client-setup-status").props.children).toBe(
      "Last done Sun 25 Oct",
    );
    fireEvent.press(view.getByTestId("client-setup-pause"));
    await waitFor(() => expect(queued(h)).toHaveLength(1));
    expect(queued(h)[0]).toMatchObject({
      method: "PUT",
      endpoint: "/trainers/me/clients/c1/forms/f-week/setup",
    });
    expect(JSON.parse(queued(h)[0]!.payload)).toEqual({ status: "paused" });
    await waitFor(() =>
      expect(view.getByLabelText(/^Weekly check-in, Paused\./)).toBeTruthy(),
    );

    // Paused → Resume.
    fireEvent.press(view.getByTestId("checkins-sentto-f-week"));
    expect(view.getByText("Resume")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-setup-pause"));
    // The pause already left (offline attempts count as sent), so the
    // resume queues its own PUT; the server keeps the last one.
    await waitFor(() =>
      expect(JSON.parse(queued(h).at(-1)!.payload)).toEqual({
        status: "active",
      }),
    );

    fireEvent.press(view.getByTestId("checkins-sentto-f-once"));
    fireEvent.press(view.getByTestId("client-setup-stop"));
    await waitFor(() =>
      expect(view.queryByTestId("checkins-sentto-f-once")).toBeNull(),
    );
    expect(JSON.parse(queued(h).at(-1)!.payload)).toEqual({
      status: "excluded",
    });
  });

  it("C10j: change the cadence for one client and Save sends the override", async () => {
    const h = setupCoachForms();
    seed(h);
    const view = h.render(
      <ClientCheckInsContainer clientId="c1" clientName="Sam Patel" />,
    );
    fireEvent.press(view.getByTestId("checkins-sentto-f-week"));
    fireEvent.press(view.getByTestId("client-setup-when-daily"));
    fireEvent.changeText(view.getByTestId("client-setup-rule-time"), "07:3");
    fireEvent.changeText(view.getByTestId("client-setup-rule-time"), "07:30");
    fireEvent.press(view.getByTestId("client-setup-save"));
    await waitFor(() =>
      expect(h.server.calls.some((c) => c.method === "PUT")).toBe(true),
    );
    const put = h.server.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      status: "active",
      override: {
        trigger: "daily",
        weekday: null,
        timeLocal: "07:30",
        dueAfterHours: 4,
        reminders: [],
      },
      scheduleId: "s-f-week",
    });
  });

  it("a join form keeps its cadence: no When, just due and reminders", () => {
    const h = setupCoachForms();
    seed(h);
    const view = h.render(
      <ClientCheckInsContainer clientId="c1" clientName="Sam" />,
    );
    fireEvent.press(view.getByTestId("checkins-sentto-f-join"));
    expect(view.queryByTestId("client-setup-when")).toBeNull();
    expect(view.getByText("No due date")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-setup-rule-due"));
    fireEvent.press(
      view.getByTestId("client-setup-rule-due-editor-amount-plus"),
    );
    expect(view.getByText("2 days after it's sent")).toBeTruthy();
    fireEvent.press(
      view.getByTestId("client-setup-rule-due-editor-unit-hours"),
    );
    fireEvent.press(
      view.getByTestId("client-setup-rule-due-editor-amount-plus"),
    );
    expect(view.getByText("49 hours after it's sent")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-setup-rule-due-editor-unit-days"));
    expect(view.getByText("2 days after it's sent")).toBeTruthy();
    fireEvent.press(
      view.getByTestId("client-setup-rule-due-editor-amount-minus"),
    );
    expect(view.getByText("1 day after it's sent")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-setup-rule-due-editor-clear"));
    expect(view.getByText("No due date")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-setup-rule-due"));
    fireEvent.press(view.getByTestId("client-setup-rule-due-editor-done"));
    expect(view.queryByTestId("client-setup-rule-due-editor")).toBeNull();
    const input = setupSaveInput(
      initialSetup(makeClientForm("f", "x", "paused", "on_join")),
    );
    expect(input.status).toBe("paused");
    expect(input.override).not.toHaveProperty("trigger");
  });

  it("+ Add picks a library form and opens its send sheet for this client", async () => {
    const h = setupCoachForms();
    seed(h);
    h.storage.cacheCoachForms(COACH, {
      forms: [makeForm("f-week", "Weekly check-in")],
      templates: [],
      asOf: "a",
    });
    h.api.coachFormsLibrary = h.storage.getCachedCoachForms(COACH)!;
    const view = h.render(
      <ClientCheckInsContainer clientId="c1" clientName="Sam" />,
    );
    fireEvent.press(view.getByTestId("checkins-sentto-head-add"));
    await waitFor(() =>
      expect(view.getByTestId("form-picker-f-week")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("form-picker-f-week"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/(app)/coach-forms/[id]",
      params: { id: "f-week", send: "1", sendTo: "c1" },
    });
    fireEvent.press(view.getByTestId("checkins-sentto-head-add"));
    fireEvent.press(view.getByTestId("form-picker-new"));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/(app)/coach-forms/edit");
  });

  it("a rule-less form starts as once", () => {
    const f = {
      ...makeClientForm("f", "x", "notDoneYet"),
      rule: null,
      rules: [],
    };
    const s = initialSetup(f);
    expect(s.trigger).toBe("once");
    expect(setupSaveInput(s)).not.toHaveProperty("scheduleId");
  });
});

describe("FormResponseContainer (review)", () => {
  it("compares with the one before by default, any earlier on request, and queues review + reply", async () => {
    const h = setupCoachForms({ online: false });
    seed(h);
    h.server.offline = true;
    mockParams = { id: "c1", responseId: "r2" };
    const view = h.render(<FormResponseContainer />);
    expect(view.getByText("Weekly check-in")).toBeTruthy();
    expect(view.getByTestId("form-response-to-review")).toBeTruthy();
    expect(view.getByText("vs Sun 18 Oct")).toBeTruthy();
    expect(view.getByText("4 / 5 ↑")).toBeTruthy();
    expect(view.getByText("3 / 5")).toBeTruthy();
    expect(view.getByText("“Work deadline”")).toBeTruthy();

    fireEvent.press(view.getByTestId("form-response-compare"));
    fireEvent.press(view.getByTestId("form-response-compare-r0"));
    expect(view.getByText("vs Sun 11 Oct")).toBeTruthy();
    expect(view.getByText("2 / 5")).toBeTruthy();
    fireEvent.press(view.getByTestId("form-response-compare"));
    fireEvent.press(view.getByTestId("form-response-compare-none"));
    expect(view.getByText("Compare")).toBeTruthy();

    fireEvent.press(view.getByTestId("form-response-mark"));
    await waitFor(() =>
      expect(view.getByTestId("form-response-reviewed")).toBeTruthy(),
    );
    expect(queued(h)).toHaveLength(1);
    expect(queued(h)[0]).toMatchObject({
      method: "POST",
      endpoint: "/trainers/me/clients/c1/form-responses/r2/review",
    });

    fireEvent.changeText(view.getByTestId("form-response-reply"), "Great week");
    fireEvent.press(view.getByTestId("form-response-send"));
    await waitFor(() =>
      expect(view.getByTestId("form-response-existing-reply")).toBeTruthy(),
    );
    // Mark reviewed already left (offline attempts count as sent), so the
    // reply queues its own idempotent POST.
    expect(queued(h)).toHaveLength(2);
    expect(JSON.parse(queued(h)[1]!.payload)).toEqual({
      replyText: "Great week",
    });
    await waitFor(() =>
      expect(view.getByTestId("form-response-offline")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("form-response-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("the oldest has nothing to compare; a missing one says so", () => {
    const h = setupCoachForms();
    seed(h);
    mockParams = { id: "c1", responseId: "r0" };
    const view = h.render(<FormResponseContainer />);
    expect(view.queryByTestId("form-response-compare")).toBeNull();
    expect(view.getByText("Reviewed Mon 12 Oct")).toBeTruthy();
    mockParams = { id: "c1", responseId: "nope" };
    const missing = h.render(<FormResponseContainer />);
    expect(missing.getByTestId("form-response-missing")).toBeTruthy();
  });
});
