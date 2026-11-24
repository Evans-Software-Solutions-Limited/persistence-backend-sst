import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { FormSchedule, FormStats } from "../api/types";
import { FormEditor, type FormEditorProps } from "../forms/FormEditor";
import {
  FormPreview,
  FormsLibrary,
  SendDialog,
  type FormsLibraryProps,
} from "../forms/FormsLibrary";
import { defaultRule, groupLibrary } from "../lib/forms";
import { FORMS, ROSTER } from "./helpers";

afterEach(cleanup);

const noop = () => {};
const sched = (over: Partial<FormSchedule>): FormSchedule => ({
  id: "s",
  formId: "f-weekly",
  trigger: "weekly",
  audience: "all_clients",
  weekday: 7,
  timeLocal: "09:00",
  dueAfterHours: null,
  reminders: [],
  status: "paused",
  ...over,
});
const client = (
  over: Partial<FormStats["forms"][number]["clients"][number]>,
) => ({
  clientId: "c",
  name: "Sam",
  requestId: "r",
  status: "done" as const,
  late: true,
  sentAt: "2026-11-22T09:00:00.000Z",
  dueAt: null,
  completedAt: null,
  remindersSent: 0,
  lastReminderAt: null,
  ...over,
});

function lib(over: Partial<FormsLibraryProps>) {
  const groups = groupLibrary(FORMS, [sched({})]);
  const props: FormsLibraryProps = {
    groups,
    stats: new Map(),
    totals: null,
    selected: groups.repeating[0]!,
    templates: null,
    showTemplates: false,
    showAllOutstanding: false,
    offlineAsOf: null,
    notice: null,
    error: null,
    onSelect: noop,
    onNew: noop,
    onEdit: noop,
    onSend: noop,
    onChange: noop,
    onPreview: noop,
    onToggleTemplates: noop,
    onUseTemplate: noop,
    onToggleOutstanding: noop,
    ...over,
  };
  return render(
    <MemoryRouter>
      <FormsLibrary {...props} />
    </MemoryRouter>,
  );
}

describe("FormsLibrary edges", () => {
  it("no stats yet: dashes, a paused rule, no due or reminders", () => {
    lib({ notice: "Saved", error: "Oops", offlineAsOf: "09:14" });
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText("No due date")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Oops")).toBeTruthy();
    expect(
      screen.getByText(/Offline · showing your forms as of 09:14/),
    ).toBeTruthy();
    expect(screen.getByText(/Not sent to anyone yet/)).toBeTruthy();
    // Not sent yet group shows, and Templates is loading when opened.
    expect(screen.getByRole("region", { name: "Not sent yet" })).toBeTruthy();
  });

  it("everyone done (one late), a daily rule's line, templates loading", () => {
    const groups = groupLibrary(FORMS, [
      sched({
        trigger: "daily",
        weekday: null,
        timeLocal: "08:00",
        status: "active",
      }),
    ]);
    lib({
      groups,
      selected: groups.repeating[0]!,
      showTemplates: true,
      stats: new Map([
        [
          "f-weekly",
          {
            formId: "f-weekly",
            reached: 1,
            done: 1,
            outstanding: 0,
            clients: [client({})],
          },
        ],
      ]),
    });
    expect(screen.getByText("done today")).toBeTruthy();
    expect(screen.getByText("Everyone has done it.")).toBeTruthy();
    expect(screen.getByText("Done late")).toBeTruthy();
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    expect(screen.getByText("Loading templates…")).toBeTruthy();
  });

  it("a once form with outstanding clients and no selection at all", () => {
    const groups = groupLibrary(FORMS, [
      sched({
        trigger: "once",
        weekday: null,
        timeLocal: null,
        status: "active",
        audience: "selected",
        clients: [],
      }),
    ]);
    lib({
      groups,
      selected: groups.once[0]!,
      stats: new Map([
        [
          "f-weekly",
          {
            formId: "f-weekly",
            reached: 1,
            done: 0,
            outstanding: 1,
            clients: [client({ status: "pending", late: false })],
          },
        ],
      ]),
    });
    expect(screen.getByText("done · 1 outstanding")).toBeTruthy();
    cleanup();
    lib({
      groups: { on_join: [], repeating: [], once: [], on_end: [], none: [] },
      selected: null,
    });
    expect(screen.getByText(/No forms yet/)).toBeTruthy();
    expect(screen.getAllByText("None yet.")).toHaveLength(4);
  });

  it("a form with no rule says Not sent yet", () => {
    const groups = groupLibrary(FORMS, []);
    lib({ groups, selected: groups.none[0]! });
    expect(screen.getByText(/^Not sent yet\./)).toBeTruthy();
  });
});

describe("SendDialog and preview edges", () => {
  it("editing keeps one cadence; nobody left to add", () => {
    render(
      <SendDialog
        form={{ ...FORMS[0]!, version: null }}
        editing={false}
        rule={defaultRule("weekly")}
        all={false}
        selected={ROSTER.data.map((c) => ({ ...c, initials: "" }))}
        candidates={[]}
        busy={false}
        error="Nope"
        onRule={noop}
        onAll={noop}
        onAdd={noop}
        onRemove={noop}
        onCancel={noop}
        onSubmit={noop}
      />,
    );
    expect(screen.getByText("0 questions")).toBeTruthy();
    expect(screen.getByText("Everyone is added")).toBeTruthy();
    expect(screen.getByText("Nope")).toBeTruthy();
  });

  it("preview with help and options; no version", () => {
    const onClose = vi.fn();
    render(
      <FormPreview
        form={{
          title: "T",
          version: {
            id: "v",
            version: 1,
            questions: [
              {
                id: "a",
                type: "single_choice",
                prompt: "Pick",
                required: false,
                help: "Any",
                options: ["x", "y"],
              },
            ],
          },
        }}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Any")).toBeTruthy();
    expect(screen.getByText("x · y")).toBeTruthy();
    cleanup();
    render(
      <FormPreview form={{ title: "T", version: null }} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

function editor(over: Partial<FormEditorProps>) {
  const props: FormEditorProps = {
    isNew: false,
    title: "Weekly check-in",
    subtitle: null,
    banner: null,
    questions: [],
    selected: 0,
    problems: new Map(),
    dirty: false,
    busy: false,
    offline: false,
    notice: null,
    error: null,
    onTitle: noop,
    onSelect: noop,
    onAdd: noop,
    onChange: noop,
    onType: noop,
    onDuplicate: noop,
    onDelete: noop,
    onMove: noop,
    onPreview: noop,
    onSave: noop,
    ...over,
  };
  return render(
    <MemoryRouter>
      <FormEditor {...props} />
    </MemoryRouter>,
  );
}

describe("FormEditor edges", () => {
  it("empty, offline, one client, no next send, busy", () => {
    editor({
      offline: true,
      busy: true,
      banner: { clients: 1, nextSend: null },
      notice: "N",
    });
    expect(
      screen.getByText("No questions yet. Add the first one."),
    ).toBeTruthy();
    expect(screen.getByText("Pick a question to edit it.")).toBeTruthy();
    expect(screen.getByText(/1 client gets this form\./)).toBeTruthy();
    expect(screen.getByText(/apply from the next one\./)).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Saving…")).toBeTruthy();
  });

  it("number fields clear to nothing; filled-for-them can be turned off; choice with no options", () => {
    const onChange = vi.fn();
    editor({
      questions: [
        {
          id: "n",
          type: "number",
          prompt: "Weight",
          required: false,
          min: 1,
          prefill: "weight",
        },
      ],
      onChange,
    });
    fireEvent.change(screen.getByLabelText("Lowest, optional"), {
      target: { value: "" },
    });
    expect(onChange.mock.calls[0]![1].min).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Filled for them"), {
      target: { value: "" },
    });
    expect(onChange.mock.calls[1]![1].prefill).toBeUndefined();
    cleanup();
    editor({
      questions: [
        { id: "c", type: "multiple_choice", prompt: "Pick", required: false },
      ],
      onChange,
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add option" }));
    expect(onChange.mock.calls[2]![1].options).toEqual(["Option 1"]);
  });

  it("the list shows a problem in place of the type line", () => {
    editor({
      questions: [{ id: "a", type: "short_text", prompt: "", required: false }],
      problems: new Map([[0, "Write the question."]]),
    });
    const row = screen.getByRole("button", { name: "Question 1: untitled" });
    expect(within(row).getByText("Write the question.")).toBeTruthy();
    expect(within(row).getByText("Untitled question")).toBeTruthy();
  });
});
