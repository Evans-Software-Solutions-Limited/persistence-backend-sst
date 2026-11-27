import { describe, expect, it } from "vitest";
import type { Question } from "../../../coaching/forms/questions";
import {
  MAX_ANSWERS_PER_CHECK_IN,
  MAX_FIELD_CHARS,
  adherenceEvidence,
  answerText,
  availableAreas,
  checkInEvidence,
  firstSummaryOn,
  isFirstWeek,
  legacySummaryText,
  mealPlanEvidence,
  parseWeeklySummary,
} from "../weeklySummary";

const q = (over: Partial<Question> & Pick<Question, "type">): Question => ({
  id: "q1",
  prompt: "How was your week?",
  required: false,
  ...over,
});

describe("firstSummaryOn — the first-week rule (design B D4)", () => {
  it.each([
    ["Monday", "2026-11-23", "2026-11-30"],
    ["Tuesday", "2026-11-24", "2026-12-07"],
    ["Wednesday", "2026-11-25", "2026-12-07"],
    ["Saturday", "2026-11-28", "2026-12-07"],
    ["Sunday", "2026-11-29", "2026-12-07"],
    // Across a month and year end.
    ["Thursday 31 Dec", "2026-12-31", "2027-01-11"],
  ])("coaching starts on a %s (%s) → first summary %s", (_d, start, due) => {
    expect(firstSummaryOn(start)).toBe(due);
  });

  it("no start date means no wait", () => {
    expect(firstSummaryOn(null)).toBeNull();
    expect(isFirstWeek("2026-11-26", null)).toBe(false);
  });

  it("is the first week strictly before the due day", () => {
    expect(isFirstWeek("2026-11-29", "2026-11-30")).toBe(true);
    expect(isFirstWeek("2026-11-30", "2026-11-30")).toBe(false);
    expect(isFirstWeek("2026-12-01", "2026-11-30")).toBe(false);
  });
});

describe("adherenceEvidence / availableAreas", () => {
  const report = {
    asOf: "2026-11-26T10:00:00.000Z",
    windowDays: 7 as const,
    training: {
      from: "2026-11-20",
      to: "2026-11-26",
      target: 4,
      done: 3,
      label: "3 of 4 in the last 7 days",
      state: "behind" as const,
    },
    calories: {
      from: "2026-11-19",
      to: "2026-11-25",
      daysOnTarget: 4,
      daysCounted: 7,
      daysNotLogged: 1,
      daysOver: 1,
      daysUnder: 1,
      perDay: [],
    },
  };

  it("keeps counts only — no per-day list, labels or dates go to the model", () => {
    expect(adherenceEvidence(report)).toEqual({
      training: { done: 3, target: 4, state: "behind" },
      calories: {
        daysOnTarget: 4,
        daysCounted: 7,
        daysNotLogged: 1,
        daysOver: 1,
        daysUnder: 1,
      },
    });
  });

  it("an untracked area is absent", () => {
    expect(adherenceEvidence({ asOf: report.asOf, windowDays: 7 })).toEqual({});
  });

  it("lists only areas that have evidence; programme week alone is not an area", () => {
    expect(availableAreas({})).toEqual([]);
    expect(availableAreas({ programme: { week: 2, of: 8 } })).toEqual([]);
    expect(availableAreas({ checkIns: [] })).toEqual([]);
    expect(
      availableAreas({
        ...adherenceEvidence(report),
        checkIns: [
          {
            title: "Weekly",
            submittedOn: "2026-11-24",
            late: false,
            answers: [],
          },
        ],
        mealPlan: { plans: 1, mealsLogged: 0, days: 0 },
      }),
    ).toEqual(["training", "calories", "checkIns", "mealPlan"]);
  });
});

describe("answerText — form answers as evidence", () => {
  it("never includes a photo answer", () => {
    expect(answerText(q({ type: "photo" }), ["media-1"])).toBeNull();
    expect(answerText(q({ type: "photo" }), "media-1")).toBeNull();
  });

  it("formats each answer type", () => {
    expect(answerText(q({ type: "yes_no" }), true)).toBe("yes");
    expect(answerText(q({ type: "yes_no" }), false)).toBe("no");
    expect(
      answerText(q({ type: "yes_no", detailsIfYes: true }), {
        value: true,
        details: "  knee niggle ",
      }),
    ).toBe("yes: knee niggle");
    expect(
      answerText(q({ type: "yes_no" }), { value: false, details: "" }),
    ).toBe("no");
    expect(answerText(q({ type: "scale" }), 4)).toBe("4/5");
    expect(answerText(q({ type: "scale", max: 10 }), 7)).toBe("7/10");
    expect(answerText(q({ type: "number", unit: "kg" }), 81.5)).toBe("81.5 kg");
    expect(answerText(q({ type: "number" }), 9000)).toBe("9000");
    expect(
      answerText(q({ type: "multiple_choice" }), ["Sleep", "Stress"]),
    ).toBe("Sleep, Stress");
    expect(answerText(q({ type: "short_text" }), "  Good\n week ")).toBe(
      "Good week",
    );
  });

  it("leaves out missing, empty and unrecognised answers", () => {
    expect(answerText(q({ type: "short_text" }), undefined)).toBeNull();
    expect(answerText(q({ type: "short_text" }), null)).toBeNull();
    expect(answerText(q({ type: "short_text" }), "   ")).toBeNull();
    expect(answerText(q({ type: "multiple_choice" }), [])).toBeNull();
    expect(answerText(q({ type: "short_text" }), { foo: 1 })).toBeNull();
  });

  it("clips long text so the prompt stays small", () => {
    const out = answerText(q({ type: "long_text" }), "x".repeat(5000))!;
    expect(out.length).toBe(280);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("checkInEvidence", () => {
  it("keeps question order, drops photos and unanswered questions, caps the count", () => {
    const questions: Question[] = [
      q({ id: "a", type: "scale", prompt: "Energy" }),
      q({ id: "p", type: "photo", prompt: "Front photo" }),
      q({ id: "b", type: "short_text", prompt: "Wins" }),
      q({ id: "c", type: "short_text", prompt: "Skipped" }),
    ];
    expect(
      checkInEvidence({
        title: "Weekly check-in",
        submittedOn: "2026-11-24",
        late: true,
        questions,
        answers: { a: 3, p: ["media-1"], b: "New squat PR" },
      }),
    ).toEqual({
      title: "Weekly check-in",
      submittedOn: "2026-11-24",
      late: true,
      answers: [
        { q: "Energy", a: "3/5" },
        { q: "Wins", a: "New squat PR" },
      ],
    });

    const many = Array.from({ length: 20 }, (_, i) =>
      q({ id: `q${i}`, type: "number" }),
    );
    const answers = Object.fromEntries(many.map((m, i) => [m.id, i]));
    expect(
      checkInEvidence({
        title: "Long",
        submittedOn: "2026-11-24",
        late: false,
        questions: many,
        answers,
      }).answers,
    ).toHaveLength(MAX_ANSWERS_PER_CHECK_IN);
  });
});

describe("mealPlanEvidence", () => {
  it("counts each plan meal once per day, inside the window only", () => {
    const out = mealPlanEvidence(
      2,
      [
        // Breakfast logged as two items on the 20th: one meal.
        { id: "e1", day: "2026-11-20", sourcePlanMealId: "m-breakfast" },
        { id: "e2", day: "2026-11-20", sourcePlanMealId: "m-breakfast" },
        { id: "e3", day: "2026-11-20", sourcePlanMealId: "m-lunch" },
        // Same breakfast again on the 21st: another meal.
        { id: "e4", day: "2026-11-21", sourcePlanMealId: "m-breakfast" },
        // A single item added from the plan, no plan meal id.
        { id: "e5", day: "2026-11-22", sourcePlanMealId: null },
        // Outside the window: today and before it.
        { id: "e6", day: "2026-11-26", sourcePlanMealId: "m-lunch" },
        { id: "e7", day: "2026-11-18", sourcePlanMealId: "m-lunch" },
      ],
      "2026-11-19",
      "2026-11-25",
    );
    expect(out).toEqual({ plans: 2, mealsLogged: 4, days: 3 });
  });
});

describe("parseWeeklySummary — strict output", () => {
  const good = {
    headline: " Steady week. ",
    areas: [
      { area: "training", status: "check", text: "3 of 4 sessions." },
      { area: "calories", status: "good", text: "4 of 7 days." },
    ],
    ask: "Ask about the missed session.",
  };

  it("accepts the exact shape, trimmed", () => {
    expect(parseWeeklySummary(good, ["training", "calories"])).toEqual({
      headline: "Steady week.",
      areas: good.areas,
      ask: "Ask about the missed session.",
    });
  });

  it("drops an area with no evidence and a repeated area", () => {
    const out = parseWeeklySummary(
      {
        ...good,
        areas: [
          ...good.areas,
          { area: "training", status: "good", text: "again" },
          { area: "mealPlan", status: "info", text: "No plan meals." },
        ],
      },
      ["training"],
    );
    expect(out?.areas).toEqual([good.areas[0]]);
  });

  it("allows no areas at all", () => {
    expect(
      parseWeeklySummary({ ...good, areas: [] }, ["training"])?.areas,
    ).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "Steady week."],
    ["an array", [good]],
    ["no headline", { areas: good.areas, ask: good.ask }],
    ["a number headline", { ...good, headline: 1 }],
    ["an empty ask", { ...good, ask: "  " }],
    ["areas not an array", { ...good, areas: {} }],
    ["an area that isn't an object", { ...good, areas: ["training"] }],
    [
      "an unknown area",
      { ...good, areas: [{ area: "sleep", status: "good", text: "x" }] },
    ],
    [
      "an unknown status",
      { ...good, areas: [{ area: "training", status: "ok", text: "x" }] },
    ],
    [
      "an empty line",
      { ...good, areas: [{ area: "training", status: "good", text: "" }] },
    ],
    [
      "an over-long headline",
      { ...good, headline: "x".repeat(MAX_FIELD_CHARS + 1) },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseWeeklySummary(raw, ["training", "calories"])).toBeNull();
  });
});

describe("legacySummaryText", () => {
  it("joins the headline and the area lines for 1.2.0 bundles", () => {
    expect(
      legacySummaryText({
        headline: "Steady week.",
        areas: [
          { area: "training", status: "check", text: "3 of 4 sessions." },
          { area: "calories", status: "good", text: "4 of 7 days." },
        ],
        ask: "Ask about it.",
      }),
    ).toBe("Steady week. 3 of 4 sessions. 4 of 7 days.");
  });
});
