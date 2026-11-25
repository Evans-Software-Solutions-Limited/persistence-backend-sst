import type { FieldValues, Resolver } from "react-hook-form";
import { messageAt } from "@/shared/form";
import type { Question } from "@/domain/models/coachForms";
import {
  firstFormProblem,
  formEditorResolver,
  replyResolver,
} from "../coachFormForms";
import {
  EMPTY_QUICK_LOG,
  mealNameResolver,
  quickLogAccepts,
  quickLogResolver,
} from "../fuelForms";
import { inviteCodeResolver, inviteConsentResolver } from "../inviteForms";
import {
  amountAccepts,
  amountResolver,
  newPlanAccepts,
  newPlanResolver,
  planNameAccepts,
  planNameResolver,
  planSaveAccepts,
  planSaveResolver,
} from "../planForms";
import {
  clientRuleAccepts,
  clientRuleResolver,
  sendSheetAccepts,
  sendSheetResolver,
} from "../ruleForms";

/** Each mobile form's rules (PER-147), through its react-hook-form resolver. */
// As react-hook-form calls it in the app: nothing registered, so `names` is
// empty (Inspector Brad, #561).
const opts = {
  fields: {},
  names: [] as never[],
  shouldUseNativeValidation: false,
};
async function errorsOf<V extends FieldValues>(
  resolver: Resolver<V>,
  values: V,
  context?: unknown,
) {
  return (await resolver(values, context, opts as never)).errors;
}

describe("invite (C11j)", () => {
  it("a code is 1–6 characters; the tick must be ticked", async () => {
    expect(
      messageAt(await errorsOf(inviteCodeResolver, { code: "  " }), "code"),
    ).toBe("Enter the code your coach shared.");
    expect(await errorsOf(inviteCodeResolver, { code: " AB12CD " })).toEqual(
      {},
    );
    expect(
      messageAt(
        await errorsOf(inviteConsentResolver, { agreed: false }),
        "agreed",
      ),
    ).toBe("Please confirm you agree to share your data.");
    expect(await errorsOf(inviteConsentResolver, { agreed: true })).toEqual({});
  });
});

describe("fuel", () => {
  it("a meal name is 1–40 characters once trimmed", async () => {
    expect(
      messageAt(await errorsOf(mealNameResolver, { name: " " }), "name"),
    ).toBe("Name the meal.");
    expect(await errorsOf(mealNameResolver, { name: " Supper " })).toEqual({});
  });

  it("quick log needs 1–10,000 kcal; macros are optional", async () => {
    const v = (kcal: string, protein = "") => ({
      ...EMPTY_QUICK_LOG,
      kcal,
      protein,
    });
    expect(quickLogAccepts(v(""))).toBe(false);
    expect(quickLogAccepts(v("0"))).toBe(false);
    expect(quickLogAccepts(v("10001"))).toBe(false);
    expect(quickLogAccepts(v("450"))).toBe(true);
    expect(quickLogAccepts(v("450,5", "30"))).toBe(true);
    expect(messageAt(await errorsOf(quickLogResolver, v("abc")), "kcal")).toBe(
      "Enter the calories.",
    );
    expect(await errorsOf(quickLogResolver, v("450", "35"))).toEqual({});
  });
});

describe("plans", () => {
  const ctx = { from: "blank", meals: 2, dayReady: false, planReady: false };

  it("New plan needs a name and a meal; a day or plan when starting from one", async () => {
    expect(newPlanAccepts({ name: "Rest day" }, ctx)).toBe(true);
    expect(newPlanAccepts({ name: " " }, ctx)).toBe(false);
    expect(newPlanAccepts({ name: "Rest" }, { ...ctx, meals: 0 })).toBe(false);
    expect(newPlanAccepts({ name: "Rest" }, { ...ctx, from: "day" })).toBe(
      false,
    );
    expect(
      newPlanAccepts({ name: "Rest" }, { ...ctx, from: "day", dayReady: true }),
    ).toBe(true);
    expect(newPlanAccepts({ name: "Rest" }, { ...ctx, from: "plan" })).toBe(
      false,
    );
    expect(
      newPlanAccepts({ name: "" }, { ...ctx, from: "mealprint", meals: 0 }),
    ).toBe(true);
    const e = await errorsOf(
      newPlanResolver,
      { name: "" },
      { ...ctx, from: "plan", meals: 0 },
    );
    expect(Object.keys(e).sort()).toEqual(["meals", "name", "planReady"]);
  });

  it("Save needs something in a new plan; an edit saves as it is", async () => {
    expect(planSaveAccepts({ mode: "new", items: 0 })).toBe(false);
    expect(planSaveAccepts({ mode: "new", items: 1 })).toBe(true);
    expect(planSaveAccepts({ mode: "edit", items: 0 })).toBe(true);
    expect(
      await errorsOf(planSaveResolver, {}, { mode: "new", items: 0 }),
    ).toHaveProperty("items");
  });

  it("an amount is a positive number and the meal isn't full", async () => {
    expect(amountAccepts({ amount: "1,5" }, { blocked: false })).toBe(true);
    expect(amountAccepts({ amount: "0" }, { blocked: false })).toBe(false);
    expect(amountAccepts({ amount: "" }, { blocked: false })).toBe(false);
    expect(amountAccepts({ amount: "2" }, { blocked: true })).toBe(false);
    expect(
      messageAt(await errorsOf(amountResolver, { amount: "x" }), "amount"),
    ).toBe("Enter an amount.");
    expect(await errorsOf(amountResolver, { amount: "2" })).toEqual({});
  });

  it("a plan name is 1–200 characters once trimmed", async () => {
    expect(planNameAccepts({ name: "  " })).toBe(false);
    expect(planNameAccepts({ name: " Easy day " })).toBe(true);
    expect(
      messageAt(await errorsOf(planNameResolver, { name: "" }), "name"),
    ).toBe("Name the plan.");
  });
});

describe("coach forms (C10b, C10h, C10j, C3.3)", () => {
  const ok: Question = {
    id: "q",
    type: "short_text",
    prompt: "Hi",
    required: true,
  };
  const problem = async (questions: Question[], title = "Form") =>
    firstFormProblem(
      await errorsOf(formEditorResolver, { title, description: "", questions }),
    );

  it("explains the first thing stopping a save, as before", async () => {
    expect(await problem([ok])).toBeNull();
    expect(await problem([ok], " ")).toBe("Give the form a title.");
    expect(await problem([ok], "x".repeat(121))).toBe(
      "Keep the title to 120 characters.",
    );
    expect(await problem([])).toBe("Add at least one question.");
    expect(
      await problem(
        Array.from({ length: 41 }, (_, i) => ({ ...ok, id: `q${i}` })),
      ),
    ).toBe("A form can have up to 40 questions.");
    expect(await problem([ok, { ...ok, prompt: " " }])).toBe(
      "Question 2 needs a question.",
    );
    expect(await problem([{ ...ok, prompt: "x".repeat(301) }])).toBe(
      "Question 1 is over 300 characters.",
    );
    expect(await problem([{ ...ok, help: "x".repeat(301) }])).toBe(
      "Question 1's help text is over 300 characters.",
    );
    const choice: Question = {
      ...ok,
      type: "single_choice",
      options: ["a", "b"],
    };
    expect(await problem([{ ...choice, options: ["a"] }])).toBe(
      "Question 1 needs 2–12 options.",
    );
    expect(await problem([{ ...choice, options: ["a", " "] }])).toBe(
      "Question 1 has an empty option.",
    );
    // Blank and repeated together: the blank is named (Inspector Brad, #561).
    expect(await problem([{ ...choice, options: ["a", "a", " "] }])).toBe(
      "Question 1 has an empty option.",
    );
    expect(await problem([{ ...choice, options: [" ", " "] }])).toBe(
      "Question 1 has an empty option.",
    );
    expect(await problem([{ ...choice, options: ["a", "a"] }])).toBe(
      "Question 1 has the same option twice.",
    );
    const num: Question = { ...ok, type: "number" };
    expect(await problem([{ ...num, min: 5, max: 1 }])).toBe(
      "Question 1: the lowest value is above the highest.",
    );
    expect(await problem([{ ...num, unit: "x".repeat(21) }])).toBe(
      "Question 1's unit is over 20 characters.",
    );
  });

  const rule = {
    weekday: 7,
    timeLocal: "09:00",
    dueAfterHours: 27,
    reminders: [{ afterHours: 9 }],
  };

  it("a weekly rule needs a day and a time; daily a time", async () => {
    expect(clientRuleAccepts({ trigger: "weekly", rule })).toBe(true);
    expect(
      clientRuleAccepts({
        trigger: "weekly",
        rule: { ...rule, weekday: null },
      }),
    ).toBe(false);
    expect(
      clientRuleAccepts({
        trigger: "daily",
        rule: { ...rule, timeLocal: null },
      }),
    ).toBe(false);
    expect(
      clientRuleAccepts({
        trigger: "once",
        rule: { ...rule, weekday: null, timeLocal: null },
      }),
    ).toBe(true);
    expect(
      clientRuleAccepts({
        trigger: "weekly",
        rule: { ...rule, timeLocal: "25:00" },
      }),
    ).toBe(false);
    const e = await errorsOf(clientRuleResolver, {
      trigger: "weekly",
      rule: { ...rule, weekday: null },
    });
    expect(messageAt(e, "rule.weekday")).toBe("Choose a day to send it.");
  });

  it("the send sheet needs someone to send to", async () => {
    const sheet = {
      trigger: "weekly" as const,
      rule,
      audience: "selected" as const,
      selectedIds: ["c1"],
    };
    expect(sendSheetAccepts(sheet)).toBe(true);
    expect(sendSheetAccepts({ ...sheet, selectedIds: [] })).toBe(false);
    expect(
      sendSheetAccepts({ ...sheet, audience: "all_clients", selectedIds: [] }),
    ).toBe(true);
    expect(sendSheetAccepts({ ...sheet, trigger: "on_join" })).toBe(false);
    const e = await errorsOf(sendSheetResolver, { ...sheet, selectedIds: [] });
    expect(messageAt(e, "selectedIds")).toBe("Add at least one client.");
  });

  it("a reply has words and fits 2,000 characters", async () => {
    expect(
      messageAt(await errorsOf(replyResolver, { reply: " " }), "reply"),
    ).toBe("Write a reply.");
    expect(
      messageAt(
        await errorsOf(replyResolver, { reply: "x".repeat(2001) }),
        "reply",
      ),
    ).toBe("Keep the reply under 2,000 characters.");
    expect(await errorsOf(replyResolver, { reply: "Nice" })).toEqual({});
  });
});
