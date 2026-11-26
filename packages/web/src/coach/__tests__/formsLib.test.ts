import { describe, expect, it } from "vitest";
import type { ClientFormRule, FormQuestion, FormSchedule } from "../api/types";
import {
  afterLabel,
  cleanQuestions,
  clientOverride,
  clientRule,
  clientTriggers,
  compareRows,
  defaultRule,
  doneLabel,
  dueWords,
  entryLine,
  formatAnswer,
  groupLibrary,
  newQuestion,
  nextSend,
  prefillFor,
  questionLine,
  reminderWords,
  responseLine,
  responseTitle,
  rowLine,
  ruleBody,
  sameQuestions,
  sendSentence,
  sentLabel,
  statusPill,
  trend,
  whoLabel,
  withTrigger,
  withType,
} from "../lib/forms";
import { formEditorResolver, problemsFrom } from "../lib/formEditorForm";
import { FORMS, SCHEDULES, response } from "./helpers";

const q = (over: Partial<FormQuestion>): FormQuestion => ({
  id: "q",
  type: "short_text",
  prompt: "Prompt",
  required: false,
  ...over,
});

const sched = (over: Partial<FormSchedule>): FormSchedule => ({
  id: "s",
  formId: "f-goals",
  trigger: "once",
  audience: "selected",
  weekday: null,
  timeLocal: null,
  dueAfterHours: null,
  reminders: [],
  status: "active",
  ...over,
});

describe("questions (C10b)", () => {
  it("describes each question in the list", () => {
    expect(questionLine(q({ type: "scale" }))).toBe("Scale 1–5");
    expect(questionLine(q({ type: "number", unit: "hours" }))).toBe(
      "Number · hours",
    );
    expect(questionLine(q({ type: "yes_no", detailsIfYes: true }))).toBe(
      "Yes / no · details if yes",
    );
    expect(
      questionLine(q({ type: "single_choice", options: ["a", "b", "c"] })),
    ).toBe("Single choice · 3 options");
    expect(questionLine(q({ type: "number", prefill: "sessions_done" }))).toBe(
      "Filled from Train",
    );
    expect(
      questionLine(q({ type: "number", unit: "kg", prefill: "weight" })),
    ).toBe("Number · kg · saves to Body");
    expect(questionLine(q({ type: "photo", prefill: "progress_photos" }))).toBe(
      "Photo · saves to Photos",
    );
    expect(questionLine(q({ type: "odd" }))).toBe("odd");
  });

  it("switching type keeps only what the new type takes", () => {
    const n = withType(
      q({
        type: "number",
        min: 1,
        max: 9,
        unit: "kg",
        help: "h",
        prefill: "weight",
      }),
      "number",
    );
    expect(n).toMatchObject({
      min: 1,
      max: 9,
      unit: "kg",
      help: "h",
      prefill: "weight",
    });
    const c = withType(n, "single_choice");
    expect(c.options).toEqual(["Option 1", "Option 2"]);
    expect(c.min).toBeUndefined();
    expect(c.prefill).toBeUndefined();
    expect(
      withType({ ...c, options: ["x", "y", "z"] }, "multiple_choice").options,
    ).toEqual(["x", "y", "z"]);
    expect(
      withType(q({ type: "yes_no", detailsIfYes: true }), "yes_no")
        .detailsIfYes,
    ).toBe(true);
    expect(newQuestion([], "scale").type).toBe("scale");
    expect(newQuestion(["a"]).id).not.toBe("a");
    expect(prefillFor("photo")).toEqual(["progress_photos"]);
    expect(prefillFor("short_text")).toEqual([]);
  });

  it("finds what the server would refuse (the editor's resolver)", async () => {
    const result = await formEditorResolver(
      {
        title: "Weekly",
        questions: [
          q({ prompt: " " }),
          q({ prompt: "x".repeat(301) }),
          q({ help: "x".repeat(301) }),
          q({ type: "single_choice", options: ["a"] }),
          q({ type: "multiple_choice", options: ["a", " "] }),
          q({ type: "single_choice", options: ["a", " a"] }),
          q({ type: "number", min: 5, max: 1 }),
          q({ type: "number", min: 1, max: 5 }),
          // A blank option is named before a repeated one.
          q({ type: "single_choice", options: [" ", " "] }),
          q({ type: "single_choice", options: Array(13).fill("o") }),
          // Blank and repeated together: the blank is named (Inspector Brad).
          q({ type: "multiple_choice", options: ["a", "a", " "] }),
          // A blank list that's too short: the count is named.
          q({ type: "single_choice", options: [" "] }),
        ],
      },
      undefined,
      { fields: {}, names: [] as string[], shouldUseNativeValidation: false },
    );
    const problems = problemsFrom(result.errors);
    expect([...problems.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);
    expect(problems.get(0)).toBe("Write the question.");
    expect(problems.get(1)).toBe("Keep the question under 300 characters.");
    expect(problems.get(2)).toBe("Keep the help text under 300 characters.");
    expect(problems.get(3)).toBe("Give 2 to 12 options.");
    expect(problems.get(4)).toBe("Fill in every option.");
    expect(problems.get(5)).toBe("Options must be different.");
    expect(problems.get(6)).toBe(
      "The lowest number must not be above the highest.",
    );
    expect(problems.get(8)).toBe("Fill in every option.");
    expect(problems.get(9)).toBe("Give 2 to 12 options.");
    expect(problems.get(10)).toBe("Fill in every option.");
    expect(problems.get(11)).toBe("Give 2 to 12 options.");
  });

  it("refuses a form with no name or no questions; passes a good one", async () => {
    const opts = {
      fields: {},
      names: [] as string[],
      shouldUseNativeValidation: false,
    } as const;
    const empty = await formEditorResolver(
      { title: "  ", questions: [] },
      undefined,
      opts,
    );
    expect(Object.keys(empty.errors).sort()).toEqual(["questions", "title"]);
    expect(problemsFrom(empty.errors).size).toBe(0);
    const good = await formEditorResolver(
      { title: "Weekly", questions: [q({})] },
      undefined,
      opts,
    );
    expect(good.errors).toEqual({});
  });

  it("cleans questions for the API and compares them", () => {
    const clean = cleanQuestions([
      q({ prompt: " Hi ", help: "  ", unit: " ", detailsIfYes: false }),
      q({ id: "b", help: " Why ", options: [" a "] }),
    ]);
    expect(clean[0]).toEqual({
      id: "q",
      type: "short_text",
      prompt: "Hi",
      required: false,
    });
    expect(clean[1]).toMatchObject({ help: "Why", options: ["a"] });
    expect(sameQuestions([q({ prompt: "A " })], [q({ prompt: "A" })])).toBe(
      true,
    );
    expect(sameQuestions([q({ prompt: "A" })], [q({ prompt: "B" })])).toBe(
      false,
    );
  });
});

describe("library (C10a)", () => {
  const schedules = [
    ...SCHEDULES,
    sched({
      id: "s-join",
      formId: "f-goals",
      trigger: "on_join",
      audience: "all_clients",
    }),
    sched({
      id: "s-old",
      formId: "f-life",
      trigger: "weekly",
      status: "stopped",
    }),
  ];

  it("groups forms by when they go out", () => {
    const groups = groupLibrary(
      [...FORMS, { ...FORMS[0]!, id: "gone", archivedAt: "2026-01-01" }],
      schedules,
    );
    expect(groups.repeating.map((r) => r.form.id)).toEqual(["f-weekly"]);
    expect(groups.on_join.map((r) => r.form.id)).toEqual(["f-goals"]);
    // A stopped rule doesn't count: not sent yet.
    expect(groups.none.map((r) => r.form.id)).toEqual(["f-life"]);
    expect(groupLibrary(FORMS, undefined).none).toHaveLength(3);
  });

  it("writes each row's lines", () => {
    const groups = groupLibrary(FORMS, schedules);
    const weekly = groups.repeating[0]!;
    expect(rowLine(weekly)).toBe(
      "Weekly · Sun 09:00 · 0 clients · 2 reminders",
    );
    expect(rowLine(groups.on_join[0]!)).toBe("14 questions · all clients");
    expect(rowLine(groups.none[0]!)).toBe("9 questions");
    const once = groupLibrary(FORMS, [
      sched({
        clients: [
          {
            clientId: "a",
            relationshipId: "r",
            status: "active",
            override: null,
          },
        ],
      }),
    ]).once[0]!;
    expect(rowLine(once, "2026-11-01T10:00:00Z")).toBe(
      "Sent Sun 1 Nov · 1 client",
    );
    expect(rowLine(once)).toBe("Once · 1 client");
    const daily = groupLibrary(FORMS, [
      sched({ trigger: "daily", timeLocal: "08:00" }),
    ]).repeating[0]!;
    expect(rowLine(daily)).toBe("Daily · 08:00 · 0 clients");
    expect(
      doneLabel(weekly, {
        formId: "f",
        reached: 11,
        done: 8,
        outstanding: 3,
        clients: [],
      }),
    ).toBe("8 of 11 this week");
    expect(
      doneLabel(daily, {
        formId: "f",
        reached: 3,
        done: 2,
        outstanding: 1,
        clients: [],
      }),
    ).toBe("2 of 3 today");
    expect(
      doneLabel(once, {
        formId: "f",
        reached: 4,
        done: 2,
        outstanding: 2,
        clients: [],
      }),
    ).toBe("2 of 4 done");
    expect(doneLabel(once, undefined)).toBe("—");
  });

  it("says who and when", () => {
    expect(whoLabel(sched({ audience: "all_clients" }))).toBe(
      "All clients, and new clients",
    );
    expect(whoLabel(sched({ clients: [] }))).toBe("0 clients");
    expect(sentLabel(SCHEDULES[0]!)).toBe("Weekly, Sunday 09:00");
    expect(sentLabel(sched({ trigger: "daily", timeLocal: "08:00" }))).toBe(
      "Daily, 08:00",
    );
    expect(sentLabel(sched({ trigger: "on_end" }))).toBe("When coaching ends");
    expect(sentLabel(sched({ trigger: "mystery" }))).toBe("mystery");
  });
});

describe("rules (C10c, C10j)", () => {
  it("speaks due and reminders as day and time, or after the send", () => {
    const weekly = defaultRule("weekly");
    expect(weekly).toMatchObject({
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
    });
    expect(dueWords(weekly)).toBe("Monday 12:00");
    expect(reminderWords(weekly, 9)).toBe("Sunday 18:00");
    const daily = {
      ...defaultRule("daily"),
      dueAfterHours: 4,
      reminders: [{ afterHours: 2 }],
    };
    expect(dueWords(daily)).toBe("Same day at 12:00");
    expect(dueWords({ ...daily, dueAfterHours: 28 })).toBe("Next day at 12:00");
    expect(dueWords({ ...daily, dueAfterHours: 52 })).toBe(
      "2 days later at 12:00",
    );
    expect(reminderWords(daily, 2)).toBe("Same day at 10:00");
    const once = { ...defaultRule("once"), dueAfterHours: 48 };
    expect(dueWords(once)).toBe("2 days after it's sent");
    expect(reminderWords(once, 6)).toBe("6 hours after it's sent");
    expect(dueWords({ ...once, dueAfterHours: null })).toBeNull();
    expect(dueWords({ ...weekly, timeLocal: null })).toBeNull();
    expect(afterLabel(168)).toBe("1 week after it's sent");
    expect(afterLabel(24)).toBe("1 day after it's sent");
    expect(afterLabel(1)).toBe("1 hour after it's sent");
  });

  it("writes the C10c sentence", () => {
    const weekly = {
      ...defaultRule("weekly"),
      reminders: [{ afterHours: 9 }, { afterHours: 24 }],
    };
    expect(sendSentence(weekly, { all: false, count: 5 })).toBe(
      "5 clients get it every Sunday at 09:00, due Monday 12:00, with reminders Sunday 18:00 and Monday 09:00 if it's not done.",
    );
    expect(sendSentence(defaultRule("daily"), { all: true, count: 0 })).toBe(
      "All your clients get it every day at 08:00.",
    );
    expect(
      sendSentence(
        {
          ...defaultRule("once"),
          dueAfterHours: 24,
          reminders: [{ afterHours: 6 }],
        },
        { all: false, count: 1 },
      ),
    ).toBe(
      "1 client gets it once, straight away, due 1 day after, with a reminder 6 hours after it's sent if it's not done.",
    );
    expect(
      sendSentence(defaultRule("on_join"), { all: true, count: 0 }),
    ).toMatch(/when they join\.$/);
    expect(
      sendSentence(defaultRule("on_end"), { all: true, count: 0 }),
    ).toMatch(/when coaching ends\.$/);
  });

  it("switches cadence and sends only the fields that apply", () => {
    const w = defaultRule("weekly");
    expect(ruleBody(withTrigger(w, "once"))).toEqual({
      weekday: null,
      timeLocal: null,
      dueAfterHours: 27,
      reminders: [{ afterHours: 9 }],
    });
    expect(withTrigger(w, "daily")).toMatchObject({
      weekday: null,
      timeLocal: "09:00",
    });
    expect(withTrigger(defaultRule("once"), "weekly")).toMatchObject({
      weekday: 7,
      timeLocal: "09:00",
    });
    expect(withTrigger(defaultRule("once"), "daily").timeLocal).toBe("08:00");
  });

  const rule: ClientFormRule = {
    scheduleId: "s",
    trigger: "weekly",
    audience: "selected",
    status: "active",
    clientStatus: "active",
    weekday: 7,
    timeLocal: "09:00",
    dueAfterHours: 27,
    reminders: [{ afterHours: 9 }],
    override: null,
  };

  it("one client's rule and override", () => {
    expect(clientRule(rule)).toMatchObject({ trigger: "weekly", weekday: 7 });
    expect(
      clientRule({
        ...rule,
        override: {
          trigger: "daily",
          timeLocal: "07:00",
          weekday: null,
          dueAfterHours: null,
          reminders: [],
        },
      }),
    ).toEqual({
      trigger: "daily",
      weekday: null,
      timeLocal: "07:00",
      dueAfterHours: null,
      reminders: [],
    });
    expect(clientOverride(rule, clientRule(rule))).toBeNull();
    expect(
      clientOverride(rule, withTrigger(clientRule(rule), "daily")),
    ).toEqual({ trigger: "daily", weekday: null });
    expect(
      clientOverride(rule, {
        ...clientRule(rule),
        timeLocal: "08:00",
        dueAfterHours: 3,
        reminders: [],
      }),
    ).toEqual({ timeLocal: "08:00", dueAfterHours: 3, reminders: [] });
    expect(clientTriggers(rule)).toEqual(["once", "weekly", "daily"]);
    expect(clientTriggers({ ...rule, trigger: "on_join" })).toEqual([
      "on_join",
    ]);
  });

  it("finds the next send", () => {
    const now = new Date(2026, 10, 24, 10, 0); // Tue 24 Nov, 10:00 local
    expect(
      nextSend({ trigger: "weekly", weekday: 7, timeLocal: "09:00" }, now),
    ).toBe("Sun 29 Nov");
    expect(
      nextSend({ trigger: "weekly", weekday: 2, timeLocal: "09:00" }, now),
    ).toBe("Tue 1 Dec");
    expect(
      nextSend({ trigger: "weekly", weekday: 2, timeLocal: "11:00" }, now),
    ).toBe("Tue 24 Nov");
    expect(
      nextSend({ trigger: "daily", weekday: null, timeLocal: "08:00" }, now),
    ).toBe("Wed 25 Nov");
    expect(
      nextSend({ trigger: "daily", weekday: null, timeLocal: "18:00" }, now),
    ).toBe("Tue 24 Nov");
    expect(
      nextSend({ trigger: "once", weekday: null, timeLocal: "18:00" }, now),
    ).toBeNull();
    expect(
      nextSend({ trigger: "daily", weekday: null, timeLocal: null }, now),
    ).toBeNull();
  });
});

describe("answers (C3.3)", () => {
  it("formats each type", () => {
    expect(formatAnswer(q({ type: "scale" }), 4)).toBe("4 / 5");
    expect(formatAnswer(q({ type: "number", unit: "kg" }), 82.4)).toBe(
      "82.4 kg",
    );
    expect(formatAnswer(q({ type: "number" }), 8450)).toBe("8,450");
    expect(formatAnswer(q({ type: "yes_no" }), true)).toBe("Yes");
    expect(formatAnswer(q({ type: "yes_no" }), false)).toBe("No");
    expect(
      formatAnswer(q({ type: "yes_no" }), {
        value: true,
        details: "Left knee",
      }),
    ).toBe("Yes: Left knee");
    expect(formatAnswer(q({ type: "yes_no" }), { value: false })).toBe("No");
    expect(formatAnswer(q({ type: "yes_no" }), { value: true })).toBe("Yes");
    expect(formatAnswer(q({ type: "multiple_choice" }), ["A", "B"])).toBe(
      "A, B",
    );
    expect(formatAnswer(q({ type: "multiple_choice" }), "A")).toBe("A");
    expect(formatAnswer(q({ type: "single_choice" }), "Good")).toBe("Good");
    expect(formatAnswer(q({ type: "short_text" }), "Fine")).toBe("“Fine”");
    expect(formatAnswer(q({ type: "photo" }), { mediaId: "m" })).toBe("Photo");
    expect(formatAnswer(q({}), undefined)).toBe("");
  });

  it("shows a malformed object answer as JSON, not [object Object]", () => {
    expect(formatAnswer(q({ type: "short_text" }), { text: "Fine" })).toBe(
      '“{"text":"Fine"}”',
    );
    expect(formatAnswer(q({ type: "scale" }), { score: 4 })).toBe(
      '{"score":4} / 5',
    );
  });

  it("trends numbers only", () => {
    expect(trend(q({ type: "scale" }), 4, 3)).toBe("up");
    expect(trend(q({ type: "number" }), 6.5, 7)).toBe("down");
    expect(trend(q({ type: "number" }), 7, 7)).toBeNull();
    expect(trend(q({ type: "number" }), "7", 7)).toBeNull();
    expect(trend(q({ type: "short_text" }), 1, 2)).toBeNull();
  });

  it("compares against an earlier version's questions", () => {
    const latest = response();
    const earlier = response({
      id: "old",
      answers: { w1: 3 },
      version: {
        id: "v0",
        version: 0,
        questions: [latest.version.questions[0]!],
      },
    });
    const rows = compareRows(latest, earlier);
    expect(rows.map((r) => [r.now, r.before, r.trend])).toEqual([
      ["4 / 5", "3 / 5", "up"],
      ["6.5 h", "", null],
      ["“Work deadline”", "", null],
    ]);
    expect(compareRows(latest, null)[0]!.before).toBe("");
  });

  it("titles and lines for History and pills", () => {
    expect(responseTitle(response())).toBe("Weekly · Sun 22 Nov");
    expect(
      responseTitle(response({ trigger: "on_join", title: "New client form" })),
    ).toBe("New client form · Sun 22 Nov");
    expect(responseLine(response())).toBe("New · 3 answers");
    expect(responseLine(response({ answers: { a: 1 } }))).toBe(
      "New · 1 answer",
    );
    expect(responseLine(response({ reviewedAt: "x", replyText: "Hi" }))).toBe(
      "Reviewed · you replied",
    );
    expect(responseLine(response({ reviewedAt: "x" }))).toBe("Reviewed");
    expect(statusPill("paused", null)).toEqual({
      tone: "paused",
      text: "Paused",
    });
    expect(statusPill("done", "2026-10-26T10:00:00Z").text).toBe(
      "Last done Mon 26 Oct",
    );
    expect(statusPill("notDoneYet", null)).toEqual({
      tone: "todo",
      text: "Not done yet",
    });
  });

  it("Sent to lines", () => {
    const base = defaultRule("weekly");
    expect(entryLine(base, null)).toBe("Every Sun 09:00 · due Mon 12:00");
    expect(entryLine({ ...base, dueAfterHours: null }, null)).toBe(
      "Every Sun 09:00",
    );
    expect(entryLine(defaultRule("daily"), null)).toBe("Daily 08:00");
    expect(entryLine(defaultRule("once"), "2026-10-27T10:00:00Z")).toBe(
      "Once · sent Tue 27 Oct",
    );
    expect(entryLine(defaultRule("on_join"), null)).toBe("When they join");
    expect(entryLine(null, "2026-10-27T10:00:00Z")).toBe("Sent Tue 27 Oct");
    expect(entryLine(null, null)).toBe("");
  });
});
