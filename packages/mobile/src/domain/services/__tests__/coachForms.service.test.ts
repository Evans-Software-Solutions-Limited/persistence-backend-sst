import type {
  ClientForm,
  ClientFormRule,
  CoachForm,
  CoachFormStats,
  FormResponse,
  FormSchedule,
  Question,
} from "@/domain/models/coachForms";
import {
  answerCount,
  clampDueHours,
  clampReminderHours,
  cleanQuestion,
  clientRuleSubtitle,
  compareRows,
  dailyDayLabel,
  dayMonth,
  defaultRule,
  draftProblem,
  duplicateQuestion,
  effectiveRule,
  fitRuleToTrigger,
  formatAnswer,
  formatMinutes,
  groupLibrary,
  historyRows,
  historyTitle,
  hoursAfterLabel,
  hoursFromMoment,
  momentFromHours,
  momentLabel,
  moveQuestion,
  newQuestion,
  normaliseReminders,
  numericAnswer,
  parseTime,
  plural,
  prefillSourcesFor,
  previousResponse,
  questionSubtitle,
  recentDay,
  responseSummary,
  retypeQuestion,
  scheduleSubtitle,
  sendMinute,
  sentToRows,
  shortDate,
  trendArrow,
} from "../coachForms.service";

const NOW = new Date("2026-10-28T12:00:00"); // Wed 28 Oct 2026, local

function form(
  id: string,
  title: string,
  n = 3,
  extra: Partial<CoachForm> = {},
): CoachForm {
  return {
    id,
    title,
    description: null,
    templateKey: null,
    available: true,
    revision: 1,
    archivedAt: null,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    version: {
      id: `${id}-v1`,
      version: 1,
      createdAt: "2026-10-01T09:00:00Z",
      questions: Array.from({ length: n }, (_, i) => ({
        id: `q${i}`,
        type: "short_text" as const,
        prompt: `Q${i}`,
        required: false,
      })),
    },
    ...extra,
  };
}

function schedule(
  id: string,
  formId: string,
  trigger: FormSchedule["trigger"],
  extra: Partial<FormSchedule> = {},
): FormSchedule {
  return {
    id,
    formId,
    trigger,
    audience: "all_clients",
    weekday: trigger === "weekly" ? 7 : null,
    timeLocal:
      trigger === "weekly" ? "09:00" : trigger === "daily" ? "08:00" : null,
    dueAfterHours: null,
    reminders: [],
    status: "active",
    revision: 1,
    clients: [],
    createdAt: "2026-10-24T10:00:00", // Sat
    updatedAt: "2026-10-24T10:00:00",
    ...extra,
  };
}

describe("times and dates", () => {
  it("parses and formats HH:MM", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(formatMinutes(570)).toBe("09:30");
    expect(formatMinutes(-60)).toBe("23:00");
    expect(formatMinutes(1500)).toBe("01:00");
  });

  it("formats dates like the canvas", () => {
    expect(shortDate("2026-10-25T10:14:00", NOW)).toBe("Sun 25 Oct");
    expect(dayMonth("2026-08-04T10:00:00", NOW)).toBe("4 Aug");
    expect(dayMonth("2025-08-04T10:00:00", NOW)).toBe("4 Aug 2025");
    expect(dayMonth("nope", NOW)).toBe("");
    expect(shortDate("nope", NOW)).toBe("");
  });

  it("says a recent day by name, today as today, and older as a date", () => {
    expect(recentDay("2026-10-24T10:00:00", NOW)).toBe("Sat");
    expect(recentDay("2026-10-28T08:00:00", NOW)).toBe("today");
    expect(recentDay("2026-10-01T08:00:00", NOW)).toBe("1 Oct");
    expect(recentDay("bad", NOW)).toBe("");
  });

  it("pluralises", () => {
    expect(plural(1, "client")).toBe("1 client");
    expect(plural(5, "client")).toBe("5 clients");
  });
});

describe("due and reminders as day + time (BRIEF)", () => {
  const weekly = { trigger: "weekly" as const, weekday: 7, timeLocal: "09:00" };
  const daily = {
    trigger: "daily" as const,
    weekday: null,
    timeLocal: "08:00",
  };
  const once = { trigger: "once" as const, weekday: null, timeLocal: null };

  it("Sun 09:00 send → Mon 12:00 due is 27 hours", () => {
    expect(hoursFromMoment(weekly, { day: 1, minutes: 12 * 60 })).toBe(27);
    expect(momentLabel(weekly, 27)).toBe("Mon 12:00");
    expect(momentLabel(weekly, 9, { long: true })).toBe("Sunday 18:00");
    expect(momentLabel(weekly, 24, { long: true })).toBe("Monday 09:00");
  });

  it("wraps to next week when the moment is at or before the send", () => {
    expect(hoursFromMoment(weekly, { day: 7, minutes: 9 * 60 })).toBe(168);
    expect(hoursFromMoment(weekly, { day: 7, minutes: 8 * 60 })).toBe(167);
  });

  it("daily: same day / next day", () => {
    expect(momentFromHours(daily, 4)).toEqual({ day: 0, minutes: 12 * 60 });
    expect(momentLabel(daily, 4)).toBe("Same day 12:00");
    expect(momentLabel(daily, 24)).toBe("Next day 08:00");
    expect(momentLabel(daily, 72)).toBe("In 3 days 08:00");
    expect(hoursFromMoment(daily, { day: 1, minutes: 9 * 60 })).toBe(25);
    expect(hoursFromMoment(daily, { day: 0, minutes: 7 * 60 })).toBe(23);
    expect(dailyDayLabel(-1)).toBe("Same day");
  });

  it("no send time: hours or days after it's sent", () => {
    expect(sendMinute(once)).toBeNull();
    expect(momentFromHours(once, 5)).toBeNull();
    expect(hoursFromMoment(once, { day: 1, minutes: 0 })).toBeNull();
    expect(momentLabel(once, 48)).toBe("2 days after it's sent");
    expect(momentLabel(once, 5)).toBe("5 hours after it's sent");
    expect(hoursAfterLabel(1)).toBe("1 hour after it's sent");
    expect(hoursAfterLabel(24)).toBe("1 day after it's sent");
  });

  it("an incomplete weekly rule has no send time", () => {
    expect(
      sendMinute({ trigger: "weekly", weekday: null, timeLocal: "09:00" }),
    ).toBeNull();
  });

  it("clamps and normalises", () => {
    expect(clampDueHours(0)).toBe(1);
    expect(clampDueHours(99999)).toBe(2160);
    expect(clampReminderHours(800)).toBe(720);
    expect(
      normaliseReminders([
        { afterHours: 24 },
        { afterHours: 9 },
        { afterHours: 9 },
        { afterHours: 1 },
        { afterHours: 2 },
        { afterHours: 3 },
        { afterHours: 4 },
      ]),
    ).toEqual([1, 2, 3, 4, 9].map((afterHours) => ({ afterHours })));
  });

  it("defaults per cadence match the canvas, and fit drops what a cadence can't carry", () => {
    expect(defaultRule("weekly")).toEqual({
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [{ afterHours: 9 }, { afterHours: 24 }],
    });
    expect(defaultRule("daily").timeLocal).toBe("08:00");
    expect(defaultRule("on_join").timeLocal).toBeNull();
    expect(
      fitRuleToTrigger("once", {
        weekday: 3,
        timeLocal: "10:00",
        dueAfterHours: 48,
        reminders: [],
      }),
    ).toEqual({
      weekday: null,
      timeLocal: null,
      dueAfterHours: 48,
      reminders: [],
    });
    expect(
      fitRuleToTrigger("weekly", {
        weekday: null,
        timeLocal: null,
        dueAfterHours: null,
        reminders: [],
      }),
    ).toMatchObject({ weekday: 7, timeLocal: "09:00" });
    expect(
      fitRuleToTrigger("daily", {
        weekday: 2,
        timeLocal: "07:00",
        dueAfterHours: 2,
        reminders: [],
      }),
    ).toMatchObject({ weekday: null, timeLocal: "07:00" });
  });

  it("a client's override fields win", () => {
    const rule: ClientFormRule = {
      scheduleId: "s1",
      trigger: "weekly",
      audience: "all_clients",
      status: "active",
      clientStatus: null,
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      override: { trigger: "daily", timeLocal: "07:30", weekday: null },
    };
    expect(effectiveRule(rule)).toEqual({
      trigger: "daily",
      weekday: 7,
      timeLocal: "07:30",
      dueAfterHours: 27,
      reminders: [],
    });
    expect(effectiveRule({ ...rule, override: null }).trigger).toBe("weekly");
  });

  it("an override's null due time is No due date for this client (Inspector Brad #556 sweep 2)", () => {
    const rule: ClientFormRule = {
      scheduleId: "s",
      trigger: "weekly",
      audience: "all_clients",
      status: "active",
      clientStatus: "active",
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      override: { dueAfterHours: null },
    };
    expect(effectiveRule(rule).dueAfterHours).toBeNull();
    // Left out of the override: the rule's own due time.
    expect(effectiveRule({ ...rule, override: {} }).dueAfterHours).toBe(27);
  });
});

describe("C10g groupLibrary", () => {
  const forms = [
    form("f-join", "New client: goals and health", 14),
    form("f-week", "Weekly check-in", 12),
    form("f-day", "Daily check-in", 5),
    form("f-once", "Progress review", 8),
    form("f-end", "Exit form", 6),
    form("f-none", "Draft form", 1),
    form("f-gone", "Archived", 2, { archivedAt: "2026-10-02T00:00:00Z" }),
  ];
  const schedules = [
    schedule("s-join", "f-join", "on_join"),
    schedule("s-week", "f-week", "weekly"),
    schedule("s-day", "f-day", "daily", {
      audience: "selected",
      clients: [
        {
          clientId: "c1",
          relationshipId: "r1",
          status: "active",
          override: null,
        },
        {
          clientId: "c2",
          relationshipId: "r2",
          status: "active",
          override: null,
        },
        {
          clientId: "c3",
          relationshipId: "r3",
          status: "excluded",
          override: null,
        },
      ],
    }),
    schedule("s-once", "f-once", "once"),
    schedule("s-end", "f-end", "on_end"),
    schedule("s-stop", "f-none", "weekly", { status: "stopped" }),
  ];
  const stats: CoachFormStats = {
    forms: [
      { formId: "f-join", reached: 14, done: 13, outstanding: 1, clients: [] },
      { formId: "f-week", reached: 11, done: 8, outstanding: 3, clients: [] },
      { formId: "f-once", reached: 4, done: 2, outstanding: 2, clients: [] },
      { formId: "f-end", reached: 0, done: 0, outstanding: 0, clients: [] },
    ],
    totals: {
      forms: 6,
      repeating: 2,
      outstanding: 6,
      onTimeRate: null,
      onTimeSample: 0,
    },
    asOf: "2026-10-28T00:00:00Z",
  };

  it("groups by when they go out, with canvas copy and counts", () => {
    const sections = groupLibrary(forms, schedules, stats, [], NOW);
    expect(sections.map((s) => s.title)).toEqual([
      "Starter forms · when they join",
      "Repeating",
      "Once",
      "When coaching ends",
      "Not sent yet",
    ]);
    expect(sections.map((s) => s.addable)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    const [join, repeating, once, end, unsent] = sections;
    expect(join!.rows[0]).toMatchObject({
      title: "New client: goals and health",
      subtitle: "14 questions · all clients",
      count: "13/14",
      countMuted: false,
    });
    expect(repeating!.rows.map((r) => [r.subtitle, r.count])).toEqual([
      ["Sun 09:00 · 11 clients", "8/11"],
      ["08:00 · 2 clients", "—"],
    ]);
    expect(once!.rows[0]!.subtitle).toBe("Sent Sat · 4 clients");
    expect(end!.rows[0]).toMatchObject({
      subtitle: "6 questions",
      count: "—",
      countMuted: true,
    });
    // A stopped rule doesn't count: that form is "Not sent yet".
    expect(unsent!.rows.map((r) => r.title)).toEqual(["Draft form"]);
    expect(unsent!.rows[0]!.subtitle).toBe("1 question");
    // Archived forms never show.
    expect(
      sections.flatMap((s) => s.rows).some((r) => r.title === "Archived"),
    ).toBe(false);
  });

  it("always shows Starter forms and Repeating, other sections only when used", () => {
    const sections = groupLibrary([], [], null);
    expect(sections.map((s) => s.key)).toEqual(["on_join", "repeating"]);
    expect(sections.every((s) => s.rows.length === 0)).toBe(true);
  });

  it("marks a conflicted form and a paused rule", () => {
    const sections = groupLibrary(
      [form("f1", "Weekly")],
      [schedule("s1", "f1", "weekly", { status: "paused" })],
      null,
      [{ key: "form:f1", at: "x" }],
      NOW,
    );
    const row = sections[1]!.rows[0]!;
    expect(row.conflict).toBe(true);
    expect(row.subtitle).toBe("Sun 09:00 · all clients · paused");
  });

  it("lists a form once per live rule", () => {
    const sections = groupLibrary(
      [form("f1", "Both")],
      [schedule("a", "f1", "on_join"), schedule("b", "f1", "weekly")],
      null,
      [],
      NOW,
    );
    expect(sections[0]!.rows[0]!.key).toBe("f1:a");
    expect(sections[1]!.rows[0]!.key).toBe("f1:b");
  });

  it("selected on_join audience counts its clients", () => {
    const s = schedule("j", "f1", "on_join", {
      audience: "selected",
      clients: [
        {
          clientId: "c",
          relationshipId: "r",
          status: "active",
          override: null,
        },
      ],
    });
    expect(scheduleSubtitle(form("f1", "x", 2), s, null, NOW)).toBe(
      "2 questions · 1 client",
    );
    expect(
      scheduleSubtitle(
        form("f1", "x", 2, { version: null }),
        schedule("e", "f1", "on_end"),
        null,
        NOW,
      ),
    ).toBe("0 questions");
    expect(
      scheduleSubtitle(
        form("f1", "x"),
        schedule("w", "f1", "weekly", { weekday: null, timeLocal: null }),
        null,
        NOW,
      ),
    ).toBe("  · all clients");
  });
});

describe("answers", () => {
  const q = (
    type: Question["type"],
    extra: Partial<Question> = {},
  ): Question => ({
    id: "q",
    type,
    prompt: "P",
    required: false,
    ...extra,
  });

  it("formats each type as the BRIEF says", () => {
    expect(formatAnswer(q("scale"), 4)).toBe("4 / 5");
    expect(formatAnswer(q("scale"), "x")).toBe("—");
    expect(formatAnswer(q("number", { unit: "kg" }), 82.4)).toBe("82.4 kg");
    expect(formatAnswer(q("number"), 8450)).toBe("8,450");
    expect(formatAnswer(q("number"), { value: 6.5 })).toBe("6.5");
    expect(formatAnswer(q("number"), "x")).toBe("—");
    expect(formatAnswer(q("yes_no"), true)).toBe("Yes");
    expect(formatAnswer(q("yes_no"), false)).toBe("No");
    expect(
      formatAnswer(q("yes_no"), { value: true, details: " Left knee " }),
    ).toBe("Yes · Left knee");
    expect(formatAnswer(q("yes_no"), { value: false, details: "x" })).toBe(
      "No",
    );
    expect(formatAnswer(q("yes_no"), "maybe")).toBe("—");
    expect(formatAnswer(q("multiple_choice"), ["A", "B"])).toBe("A, B");
    expect(formatAnswer(q("multiple_choice"), [])).toBe("—");
    expect(formatAnswer(q("single_choice"), "A")).toBe("A");
    expect(formatAnswer(q("photo"), { path: "x" })).toBe("Photo");
    expect(formatAnswer(q("short_text"), "Work deadline")).toBe(
      "“Work deadline”",
    );
    expect(formatAnswer(q("short_text"), 3)).toBe("—");
    expect(formatAnswer(q("long_text"), "Long")).toBe("Long");
    expect(formatAnswer(q("long_text"), 3)).toBe("—");
    expect(formatAnswer(q("long_text"), null)).toBe("—");
    expect(formatAnswer(q("long_text"), "")).toBe("—");
  });

  it("arrows for numbers and scales that changed", () => {
    expect(trendArrow(q("scale"), 4, 3)).toBe("↑");
    expect(trendArrow(q("number"), 6.5, 7)).toBe("↓");
    expect(trendArrow(q("number"), 7, 7)).toBe("");
    expect(trendArrow(q("number"), 7, undefined)).toBe("");
    expect(trendArrow(q("short_text"), 1, 2)).toBe("");
    expect(numericAnswer(NaN)).toBeNull();
  });
});

function response(
  id: string,
  submittedAt: string,
  answers: Record<string, unknown>,
  extra: Partial<FormResponse> = {},
): FormResponse {
  return {
    id,
    requestId: `req-${id}`,
    formId: "f-week",
    title: "Weekly check-in",
    trigger: "weekly",
    periodKey: "2026-W43",
    sentAt: submittedAt,
    submittedAt,
    late: false,
    answers,
    reviewedAt: null,
    replyText: null,
    version: {
      id: "v",
      version: 1,
      questions: [
        {
          id: "energy",
          type: "scale",
          prompt: "Energy this week",
          required: true,
        },
        {
          id: "sleep",
          type: "number",
          prompt: "Sleep, average",
          required: true,
          unit: "h",
        },
        { id: "stress", type: "short_text", prompt: "Stress", required: false },
        {
          id: "weight",
          type: "number",
          prompt: "Weight",
          required: false,
          unit: "kg",
        },
        { id: "steps", type: "number", prompt: "Steps", required: false },
      ],
    },
    ...extra,
  };
}

describe("C3.3b Check-ins", () => {
  const latest = response("r2", "2026-10-25T10:14:00", {
    energy: 4,
    sleep: 6.5,
    stress: "Work deadline",
    weight: 82.4,
    steps: 8450,
  });
  const earlier = response(
    "r1",
    "2026-10-18T10:00:00",
    { energy: 3, sleep: 7, stress: "Fine", weight: 82 },
    { reviewedAt: "2026-10-19T09:00:00Z", replyText: "Nice" },
  );
  const join = response(
    "r0",
    "2026-08-04T10:00:00",
    { a: "x" },
    {
      formId: "f-join",
      title: "New client form",
      trigger: "on_join",
      reviewedAt: "2026-08-05T00:00:00Z",
    },
  );
  const all = [latest, earlier, join];

  it("summarises the latest against the one before (canvas line)", () => {
    expect(previousResponse(all, latest)?.id).toBe("r1");
    expect(previousResponse(all, earlier)).toBeNull();
    expect(responseSummary(latest, earlier)).toBe(
      "Energy 4/5 ↑ · sleep 6.5 h ↓ · weight 82.4 kg ↑",
    );
    expect(responseSummary(latest, null)).toBe(
      "Energy 4/5 · sleep 6.5 h · weight 82.4 kg",
    );
    expect(responseSummary(join, null)).toBe("1 answer");
  });

  it("history rows with review state", () => {
    expect(historyRows(all, NOW)).toEqual([
      {
        id: "r2",
        title: "Weekly · Sun 25 Oct",
        subtitle: "New · 5 answers",
        toReview: true,
      },
      {
        id: "r1",
        title: "Weekly · Sun 18 Oct",
        subtitle: "Reviewed · you replied",
        toReview: false,
      },
      {
        id: "r0",
        title: "New client form · 4 Aug",
        subtitle: "Reviewed",
        toReview: false,
      },
    ]);
    expect(historyTitle({ ...latest, trigger: "daily" }, NOW)).toBe(
      "Daily · Sun 25 Oct",
    );
    expect(
      answerCount(response("x", "2026-10-01", { a: null, b: "", c: 1 })),
    ).toBe(1);
  });

  it("compare rows against any earlier response", () => {
    const rows = compareRows(latest, earlier);
    expect(rows[0]).toEqual({
      id: "energy",
      prompt: "Energy this week",
      latest: "4 / 5",
      previous: "3 / 5",
      arrow: "↑",
    });
    expect(rows[4]).toMatchObject({ latest: "8,450", previous: "—" });
    expect(compareRows(latest, null)[0]!.previous).toBeNull();
    const other = {
      ...earlier,
      version: { ...earlier.version, questions: [] },
    };
    expect(compareRows(latest, other)[0]).toMatchObject({
      previous: "—",
      arrow: "",
    });
  });

  const clientForm = (
    state: ClientForm["state"],
    extra: Partial<ClientForm> = {},
  ): ClientForm => ({
    form: { id: "f-week", title: "Weekly check-in", archivedAt: null },
    rule: {
      scheduleId: "s1",
      trigger: "weekly",
      audience: "all_clients",
      status: "active",
      clientStatus: null,
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      override: null,
    },
    rules: [],
    lastDoneAt: "2026-10-25T10:14:00",
    lastSentAt: "2026-10-27T09:00:00",
    pendingRequestId: null,
    state,
    ...extra,
  });

  it("Sent to rows with last-done pills", () => {
    expect(sentToRows([clientForm("done")], NOW)[0]).toEqual({
      formId: "f-week",
      title: "Weekly check-in",
      subtitle: "Sun 09:00",
      pill: { tone: "done", text: "Last done Sun 25 Oct" },
    });
    expect(sentToRows([clientForm("notDoneYet")], NOW)[0]!.pill).toEqual({
      tone: "waiting",
      text: "Not done yet",
    });
    expect(sentToRows([clientForm("paused")], NOW)[0]!.pill.text).toBe(
      "Paused",
    );
  });

  it("rule wording per cadence", () => {
    const base = clientForm("done");
    const withRule = (
      trigger: ClientFormRule["trigger"],
      extra: Partial<ClientForm> = {},
    ) =>
      clientRuleSubtitle(
        { ...base, rule: { ...base.rule!, trigger }, ...extra },
        NOW,
      );
    expect(withRule("daily")).toBe("Daily 08:00".replace("08:00", "09:00"));
    expect(withRule("once")).toBe("Once · sent Tue 27 Oct");
    expect(withRule("once", { lastSentAt: null })).toBe("Once");
    expect(withRule("on_join")).toBe("When they join");
    expect(withRule("on_end")).toBe("When coaching ends");
    expect(clientRuleSubtitle({ ...base, rule: null }, NOW)).toBe(
      "Sent Tue 27 Oct",
    );
    expect(
      clientRuleSubtitle({ ...base, rule: null, lastSentAt: null }, NOW),
    ).toBe("");
    expect(
      clientRuleSubtitle(
        { ...base, rule: { ...base.rule!, weekday: null, timeLocal: null } },
        NOW,
      ),
    ).toBe("");
    expect(
      clientRuleSubtitle(
        { ...base, rule: { ...base.rule!, trigger: "daily", timeLocal: null } },
        NOW,
      ),
    ).toBe("Daily");
  });
});

describe("C10b editor rules", () => {
  it("new questions get ids and type defaults", () => {
    const a = newQuestion();
    const b = newQuestion("single_choice");
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ type: "short_text", prompt: "", required: true });
    expect(b.options).toEqual(["Option 1", "Option 2"]);
  });

  it("retyping drops what the new type can't carry", () => {
    const n: Question = {
      id: "q",
      type: "number",
      prompt: "Weight",
      required: true,
      min: 1,
      max: 300,
      unit: "kg",
      help: "Morning",
      prefill: "weight",
    };
    expect(retypeQuestion(n, "scale")).toEqual({
      id: "q",
      type: "scale",
      prompt: "Weight",
      required: true,
      help: "Morning",
    });
    expect(retypeQuestion(n, "number")).toEqual(n);
    const yn = retypeQuestion(
      { ...n, type: "yes_no", detailsIfYes: true },
      "yes_no",
    );
    expect(yn.detailsIfYes).toBe(true);
    const choice = retypeQuestion(
      { ...n, options: ["a", "b", "c"] },
      "multiple_choice",
    );
    expect(choice.options).toEqual(["a", "b", "c"]);
    expect(
      retypeQuestion({ ...n, prefill: "progress_photos" }, "photo").prefill,
    ).toBe("progress_photos");
  });

  it("duplicates with a new id and its own options", () => {
    const q: Question = {
      id: "q",
      type: "single_choice",
      prompt: "x",
      required: false,
      options: ["a", "b"],
    };
    const d = duplicateQuestion(q);
    expect(d.id).not.toBe("q");
    expect(d.options).toEqual(["a", "b"]);
    expect(d.options).not.toBe(q.options);
    expect(
      duplicateQuestion({ id: "z", type: "photo", prompt: "p", required: true })
        .options,
    ).toBeUndefined();
  });

  it("moves questions and ignores out-of-range moves", () => {
    const qs = ["a", "b", "c"].map((id) => ({
      id,
      type: "photo" as const,
      prompt: id,
      required: false,
    }));
    expect(moveQuestion(qs, 0, 1).map((q) => q.id)).toEqual(["b", "a", "c"]);
    expect(moveQuestion(qs, 2, -1).map((q) => q.id)).toEqual(["a", "c", "b"]);
    expect(moveQuestion(qs, 0, -1).map((q) => q.id)).toEqual(["a", "b", "c"]);
    expect(moveQuestion(qs, 5, 1).map((q) => q.id)).toEqual(["a", "b", "c"]);
  });

  it("cleans questions for the server", () => {
    expect(
      cleanQuestion({
        id: "q",
        type: "number",
        prompt: "  Sleep ",
        required: true,
        help: "  ",
        unit: " ",
      }),
    ).toEqual({ id: "q", type: "number", prompt: "Sleep", required: true });
    expect(
      cleanQuestion({
        id: "q",
        type: "single_choice",
        prompt: "x",
        required: true,
        options: [" a ", "b"],
        help: " h ",
      }),
    ).toEqual({
      id: "q",
      type: "single_choice",
      prompt: "x",
      required: true,
      options: ["a", "b"],
      help: "h",
    });
    expect(
      cleanQuestion({
        id: "q",
        type: "number",
        prompt: "x",
        required: true,
        unit: " kg ",
      }).unit,
    ).toBe("kg");
  });

  it("explains the first thing stopping a save", () => {
    const ok: Question = {
      id: "q",
      type: "short_text",
      prompt: "Hi",
      required: true,
    };
    const d = (questions: Question[], title = "Form") =>
      draftProblem({ title, description: null, questions });
    expect(d([ok])).toBeNull();
    expect(d([ok], " ")).toBe("Give the form a title.");
    expect(d([ok], "x".repeat(121))).toBe("Keep the title to 120 characters.");
    expect(d([])).toBe("Add at least one question.");
    expect(
      d(Array.from({ length: 41 }, (_, i) => ({ ...ok, id: `q${i}` }))),
    ).toBe("A form can have up to 40 questions.");
    expect(d([{ ...ok, prompt: " " }])).toBe("Question 1 needs a question.");
    expect(d([{ ...ok, prompt: "x".repeat(301) }])).toBe(
      "Question 1 is over 300 characters.",
    );
    expect(d([{ ...ok, help: "x".repeat(301) }])).toBe(
      "Question 1's help text is over 300 characters.",
    );
    const choice: Question = {
      ...ok,
      type: "single_choice",
      options: ["a", "b"],
    };
    expect(d([{ ...choice, options: ["a"] }])).toBe(
      "Question 1 needs 2–12 options.",
    );
    expect(d([{ ...choice, options: ["a", " "] }])).toBe(
      "Question 1 has an empty option.",
    );
    expect(d([{ ...choice, options: ["a", "a"] }])).toBe(
      "Question 1 has the same option twice.",
    );
    const num: Question = { ...ok, type: "number" };
    expect(d([{ ...num, min: 5, max: 1 }])).toBe(
      "Question 1: the lowest value is above the highest.",
    );
    expect(d([{ ...num, unit: "x".repeat(21) }])).toBe(
      "Question 1's unit is over 20 characters.",
    );
  });

  it("subtitles and filled-for-them sources", () => {
    expect(
      questionSubtitle({
        id: "q",
        type: "number",
        prompt: "x",
        required: true,
        unit: "hours",
      }),
    ).toBe("Number · hours");
    expect(
      questionSubtitle({
        id: "q",
        type: "yes_no",
        prompt: "x",
        required: true,
        detailsIfYes: true,
      }),
    ).toBe("Yes / no · details if yes");
    expect(
      questionSubtitle({
        id: "q",
        type: "multiple_choice",
        prompt: "x",
        required: true,
        options: ["a", "b"],
      }),
    ).toBe("Multiple choice · 2 options");
    expect(
      questionSubtitle({
        id: "q",
        type: "number",
        prompt: "x",
        required: true,
        prefill: "sessions_done",
      }),
    ).toBe("Filled from Train");
    expect(prefillSourcesFor("number")).toEqual([
      "sessions_done",
      "meal_plan_followed",
      "steps",
      "weight",
    ]);
    expect(prefillSourcesFor("photo")).toEqual(["progress_photos"]);
    expect(prefillSourcesFor("scale")).toEqual([]);
  });
});
