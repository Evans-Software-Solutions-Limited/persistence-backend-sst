import { fireEvent, waitFor } from "@testing-library/react-native";
import { CoachFormEditorContainer } from "@/ui/containers/CoachFormEditorContainer";
import { COACH, makeForm, q, setupCoachForms } from "./coachFormsTestKit";

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

const queued = (h: ReturnType<typeof setupCoachForms>) =>
  h.storage.getUncompletedMutations();

describe("CoachFormEditorContainer (C10b on iPhone)", () => {
  it("builds a new form with every answer type and queues a keyed POST offline", async () => {
    const h = setupCoachForms({ online: false });
    h.server.offline = true;
    mockParams = { trigger: "on_join" };
    const view = h.render(<CoachFormEditorContainer />);
    await waitFor(() =>
      expect(view.getByTestId("form-editor-offline")).toBeTruthy(),
    );

    // Can't save without a title.
    fireEvent.press(view.getByTestId("form-editor-save"));
    expect(view.getByTestId("form-editor-problem").props.children).toBe(
      "Give the form a title.",
    );
    fireEvent.changeText(
      view.getByTestId("form-editor-title"),
      "Weekly check-in",
    );
    fireEvent.changeText(
      view.getByTestId("form-editor-description"),
      "Every Sunday",
    );

    // Question 1 is open: a scale with help text.
    fireEvent.changeText(
      view.getByTestId("form-editor-q-0-prompt"),
      "Energy this week",
    );
    fireEvent.changeText(view.getByTestId("form-editor-q-0-help"), "1 is flat");
    fireEvent.press(view.getByTestId("form-editor-q-0-type-scale"));
    fireEvent.press(view.getByTestId("form-editor-q-0-required"));

    // Question 2: a number filled for them, with min/max/unit.
    fireEvent.press(view.getByTestId("form-editor-add"));
    fireEvent.changeText(view.getByTestId("form-editor-q-1-prompt"), "Weight");
    fireEvent.press(view.getByTestId("form-editor-q-1-type-number"));
    fireEvent.changeText(view.getByTestId("form-editor-q-1-min"), "30");
    fireEvent.changeText(view.getByTestId("form-editor-q-1-max"), "x");
    fireEvent.changeText(view.getByTestId("form-editor-q-1-max"), "300");
    fireEvent.changeText(view.getByTestId("form-editor-q-1-unit"), "kg");
    fireEvent.press(view.getByTestId("form-editor-q-1-prefill-weight"));

    // Question 3: yes/no with details.
    fireEvent.press(view.getByTestId("form-editor-add"));
    fireEvent.changeText(
      view.getByTestId("form-editor-q-2-prompt"),
      "Any pain?",
    );
    fireEvent.press(view.getByTestId("form-editor-q-2-type-yes_no"));
    fireEvent.press(view.getByTestId("form-editor-q-2-details"));

    // Question 4: choices, add one, remove one.
    fireEvent.press(view.getByTestId("form-editor-add"));
    fireEvent.changeText(view.getByTestId("form-editor-q-3-prompt"), "Mood");
    fireEvent.press(view.getByTestId("form-editor-q-3-type-multiple_choice"));
    fireEvent.press(view.getByTestId("form-editor-q-3-add-option"));
    fireEvent.changeText(view.getByTestId("form-editor-q-3-option-2"), "Great");
    fireEvent.press(view.getByTestId("form-editor-q-3-option-0-remove"));

    // Question 5: a photo, duplicated, then the copy deleted.
    fireEvent.press(view.getByTestId("form-editor-add"));
    fireEvent.changeText(view.getByTestId("form-editor-q-4-prompt"), "Photos");
    fireEvent.press(view.getByTestId("form-editor-q-4-type-photo"));
    fireEvent.press(
      view.getByTestId("form-editor-q-4-prefill-progress_photos"),
    );
    fireEvent.press(view.getByTestId("form-editor-q-4-duplicate"));
    expect(view.getByTestId("form-editor-q-5-fields")).toBeTruthy();
    fireEvent.press(view.getByTestId("form-editor-q-5-delete"));

    // The other types are reachable too.
    fireEvent.press(view.getByTestId("form-editor-add"));
    fireEvent.changeText(view.getByTestId("form-editor-q-5-prompt"), "Notes");
    for (const t of ["long_text", "single_choice", "short_text"]) {
      fireEvent.press(view.getByTestId(`form-editor-q-5-type-${t}`));
    }
    // Reorder: move it up, then down again.
    fireEvent.press(view.getByTestId("form-editor-q-5-up"));
    fireEvent.press(view.getByTestId("form-editor-q-4-down"));
    // Collapse and reopen a question.
    fireEvent.press(view.getByTestId("form-editor-q-0"));
    expect(view.getByTestId("form-editor-q-0-fields")).toBeTruthy();
    fireEvent.press(view.getByTestId("form-editor-q-0"));
    expect(view.queryByTestId("form-editor-q-0-fields")).toBeNull();
    expect(view.getByText("Filled from Body")).toBeTruthy();

    fireEvent.press(view.getByTestId("form-editor-save"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(queued(h)).toHaveLength(1);
    const entry = queued(h)[0]!;
    expect(entry).toMatchObject({
      method: "POST",
      endpoint: "/trainers/me/forms",
    });
    expect(entry.idempotencyKey).toBeTruthy();
    const body = JSON.parse(entry.payload);
    expect(body.title).toBe("Weekly check-in");
    expect(body.description).toBe("Every Sunday");
    expect(body.questions.map((x: { type: string }) => x.type)).toEqual([
      "scale",
      "number",
      "yes_no",
      "multiple_choice",
      "photo",
      "short_text",
    ]);
    expect(body.questions[0]).toMatchObject({
      prompt: "Energy this week",
      help: "1 is flat",
      required: false,
    });
    expect(body.questions[1]).toMatchObject({
      min: 30,
      max: 300,
      unit: "kg",
      prefill: "weight",
    });
    expect(body.questions[2]).toMatchObject({ detailsIfYes: true });
    expect(body.questions[3].options).toEqual(["Option 2", "Great"]);
    expect(body.questions[4]).toMatchObject({ prefill: "progress_photos" });
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/coach-forms/[id]",
      params: {
        id: expect.stringMatching(/^local-/),
        send: "1",
        trigger: "on_join",
      },
    });
  });

  it("edits a saved form: PATCH with expectedRevision, then back", async () => {
    const h = setupCoachForms();
    const form = makeForm("f1", "Weekly check-in", [q("a"), q("b")]);
    h.storage.cacheCoachForms(COACH, {
      forms: [form],
      templates: [],
      asOf: "x",
    });
    h.api.coachFormsLibrary = { forms: [form], templates: [], asOf: "x" };
    mockParams = { id: "f1" };
    const view = h.render(<CoachFormEditorContainer />);
    expect(view.getByTestId("form-editor-meta").props.children).toBe(
      "2 questions · version 3",
    );
    fireEvent.press(view.getByTestId("form-editor-q-1"));
    fireEvent.press(view.getByTestId("form-editor-q-1-up"));
    fireEvent.press(view.getByTestId("form-editor-q-0-delete"));
    fireEvent.press(view.getByTestId("form-editor-save"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const patch = h.server.calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toMatch(/\/trainers\/me\/forms\/f1$/);
    expect(patch.body).toMatchObject({ expectedRevision: 2 });
    expect((patch.body.questions as { id: string }[]).map((x) => x.id)).toEqual(
      ["a"],
    );
  });

  it("a 409 loads the server copy and says Edited on another device", async () => {
    const h = setupCoachForms();
    const form = makeForm("f1", "Mine", [q("a")]);
    h.storage.cacheCoachForms(COACH, {
      forms: [form],
      templates: [],
      asOf: "x",
    });
    h.api.coachFormsLibrary = { forms: [form], templates: [], asOf: "x" };
    h.server.nextStatus = 409;
    h.server.nextBody = {
      code: "revision_conflict",
      current: makeForm("f1", "Edited on the web", [q("z")], { revision: 7 }),
    };
    mockParams = { id: "f1" };
    const view = h.render(<CoachFormEditorContainer />);
    fireEvent.changeText(view.getByTestId("form-editor-title"), "Mine, edited");
    fireEvent.press(view.getByTestId("form-editor-save"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    // The queue dropped it and the cache holds the server copy.
    expect(queued(h)).toHaveLength(0);
    expect(h.storage.getCachedCoachForms(COACH)!.forms[0]).toMatchObject({
      title: "Edited on the web",
      revision: 7,
    });
    expect(h.storage.getCoachFormConflicts(COACH).map((c) => c.key)).toEqual([
      "form:f1",
    ]);

    // Opening the editor again shows it, with the server copy loaded.
    const again = h.render(<CoachFormEditorContainer />);
    await waitFor(() =>
      expect(again.getByTestId("form-editor-conflict")).toBeTruthy(),
    );
    expect(again.getByText("Edited on another device")).toBeTruthy();
    expect(again.getByTestId("form-editor-title").props.value).toBe(
      "Edited on the web",
    );
    fireEvent.press(again.getByTestId("form-editor-conflict-dismiss"));
    await waitFor(() =>
      expect(again.queryByTestId("form-editor-conflict")).toBeNull(),
    );
  });

  it("blocks a save with an empty question and back leaves", () => {
    const h = setupCoachForms();
    const view = h.render(<CoachFormEditorContainer />);
    fireEvent.changeText(view.getByTestId("form-editor-title"), "Form");
    fireEvent.press(view.getByTestId("form-editor-save"));
    expect(view.getByText("Question 1 needs a question.")).toBeTruthy();
    expect(queued(h)).toHaveLength(0);
    fireEvent.press(view.getByTestId("form-editor-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
