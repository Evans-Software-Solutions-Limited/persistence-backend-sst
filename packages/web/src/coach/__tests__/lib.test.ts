import { describe, expect, it } from "vitest";
import type { FormSchedule, SetupItem } from "../api/types";
import {
  declarationText,
  declarationTextHash,
  needsDeclaration,
} from "../lib/declaration";
import { draftError, itemsToSave, sameItems } from "../lib/draft";
import {
  clockTime,
  contactOf,
  firstName,
  initials,
  joinName,
  lastActive,
  parseContact,
  splitName,
} from "../lib/people";
import {
  dueLabel,
  effectiveRule,
  formatTime,
  hoursUntil,
  isRepeatingTrigger,
  normaliseReminders,
  overrideFrom,
  parseTime,
  pointAfter,
  reminderLabel,
  ruleDetail,
  ruleSummary,
} from "../lib/schedule";
import { applyPatch, clampSessions, trainingPatch } from "../lib/settings";
import {
  buildLibrary,
  checklistCount,
  checklistSummary,
  daysLeft,
  emptyLibrary,
  formMeta,
  formTitle,
  inviteMailto,
  inviteState,
  itemsOf,
  overviewSummary,
  overviewTitle,
  planMeta,
  questionTypeLabel,
  readyLines,
  scheduleTitle,
  summaryInviteState,
  targetNumbers,
} from "../lib/setup";
import { changedFields, toInput, valuesFrom } from "../lib/whoForm";
import { FORMS, PLANS, SCHEDULES, detail, settings } from "./helpers";

const weekly: FormSchedule = SCHEDULES[0];
const lib = buildLibrary(FORMS, SCHEDULES, PLANS);
const item = (over: Partial<SetupItem> = {}): SetupItem => ({
  refId: null,
  config: {},
  sortOrder: 0,
  ...over,
});

describe("people", () => {
  it("joins and splits names", () => {
    expect(joinName(" Lena ", " Ortiz ")).toBe("Lena Ortiz");
    expect(joinName("Lena", "")).toBe("Lena");
    expect(splitName("Lena  van Ortiz")).toEqual({
      first: "Lena",
      last: "van Ortiz",
    });
    expect(splitName("  ")).toEqual({ first: "", last: "" });
    expect(firstName("Lena Ortiz")).toBe("Lena");
    expect(initials("Lena van Ortiz")).toBe("LO");
    expect(initials("cher")).toBe("C");
    expect(initials(" ")).toBe("?");
  });

  it("reads the single contact field as email or mobile", () => {
    expect(parseContact("")).toEqual({ kind: "empty" });
    expect(parseContact(" lena@example.com ")).toEqual({
      kind: "email",
      value: "lena@example.com",
    });
    expect(parseContact("lena@")).toEqual({ kind: "invalid" });
    expect(parseContact("+44 7700 900123")).toEqual({
      kind: "phone",
      value: "+44 7700 900123",
    });
    expect(parseContact("call me")).toEqual({ kind: "invalid" });
    expect(contactOf({ contactEmail: null, contactPhone: "0770" })).toBe(
      "0770",
    );
    expect(contactOf({ contactEmail: null, contactPhone: null })).toBe("");
  });

  it("says how long ago a client was active", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    expect(lastActive(null, now)).toBeNull();
    expect(lastActive("nope", now)).toBeNull();
    expect(lastActive("2026-11-23T11:59:50Z", now)).toBe("just now");
    expect(lastActive("2026-11-23T11:30:00Z", now)).toBe("30m");
    expect(lastActive("2026-11-23T10:00:00Z", now)).toBe("2h");
    expect(lastActive("2026-11-20T12:00:00Z", now)).toBe("3d");
    expect(lastActive("2026-11-01T12:00:00Z", now)).toBe("3w");
    expect(clockTime(new Date(2026, 10, 23, 9, 4).getTime())).toBe("09:04");
  });
});

describe("schedule rules", () => {
  it("merges a client's override over the send rule", () => {
    expect(effectiveRule(weekly, null)).toMatchObject({
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
    });
    expect(effectiveRule(weekly, { weekday: 1, reminders: [] })).toMatchObject({
      weekday: 1,
      reminders: [],
    });
  });

  it("converts between hours after sending and a weekday + time", () => {
    const rule = effectiveRule(weekly, null);
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(formatTime(-60)).toBe("23:00");
    expect(pointAfter(rule, 27)).toEqual({ weekday: 1, time: "12:00" });
    expect(pointAfter({ weekday: null, timeLocal: "21:00" }, 5)).toEqual({
      weekday: null,
      time: "02:00",
    });
    expect(pointAfter({ weekday: 1, timeLocal: null }, 5)).toBeNull();
    expect(hoursUntil(rule, { weekday: 1, time: "12:00" })).toBe(27);
    expect(hoursUntil(rule, { weekday: 7, time: "09:00" })).toBe(168);
    expect(
      hoursUntil(
        { weekday: null, timeLocal: "21:00" },
        { weekday: null, time: "02:00" },
      ),
    ).toBe(5);
    expect(hoursUntil(rule, { weekday: 1, time: "bad" })).toBeNull();
  });

  it("describes rules for the checklist and the overview", () => {
    const rule = effectiveRule(weekly, null);
    expect(ruleSummary(rule)).toBe("Weekly · Sun 09:00 · 2 reminders");
    expect(ruleDetail(rule)).toBe(
      "Sundays 09:00 · due Mon 12:00 · 2 reminders",
    );
    expect(dueLabel(rule)).toBe("Mon 12:00");
    expect(dueLabel({ ...rule, dueAfterHours: null })).toBeNull();
    expect(reminderLabel(rule, 9)).toBe("Sunday 18:00");
    const daily = {
      ...rule,
      trigger: "daily",
      weekday: null,
      reminders: [{ afterHours: 1 }],
    };
    expect(ruleSummary(daily)).toBe("Daily · 09:00 · 1 reminder");
    expect(ruleDetail(daily)).toBe("Daily 09:00 · due 12:00 · 1 reminder");
    const once = {
      ...rule,
      trigger: "once",
      weekday: null,
      timeLocal: null,
      dueAfterHours: null,
      reminders: [],
    };
    expect(ruleSummary(once)).toBe("Once");
    expect(ruleDetail(once)).toBe("Once");
    expect(ruleSummary({ ...once, trigger: "custom" })).toBe("custom");
  });

  it("keeps only the changed fields in an override", () => {
    const rule = effectiveRule(weekly, null);
    expect(overrideFrom(weekly, rule)).toBeNull();
    expect(
      overrideFrom(weekly, {
        ...rule,
        weekday: 1,
        timeLocal: "07:00",
        dueAfterHours: 3,
        reminders: [{ afterHours: 2 }],
      }),
    ).toEqual({
      weekday: 1,
      timeLocal: "07:00",
      dueAfterHours: 3,
      reminders: [{ afterHours: 2 }],
    });
  });

  it("normalises reminders like the server does", () => {
    expect(
      normaliseReminders([
        { afterHours: 24 },
        { afterHours: 9 },
        { afterHours: 9 },
        { afterHours: 0 },
        { afterHours: 900 },
      ]),
    ).toEqual([{ afterHours: 9 }, { afterHours: 24 }]);
    expect(
      normaliseReminders(
        [1, 2, 3, 4, 5, 6].map((afterHours) => ({ afterHours })),
      ),
    ).toHaveLength(5);
    expect(isRepeatingTrigger("weekly")).toBe(true);
    expect(isRepeatingTrigger("on_join")).toBe(false);
  });
});

describe("set-up summaries", () => {
  it("summarises each section on the checklist", () => {
    expect(checklistSummary("starter_form", [], lib, "Lena Ortiz")).toBe(
      "Not added",
    );
    expect(
      checklistSummary(
        "starter_form",
        [item({ refId: "f-goals" }), item({ refId: "f-life" })],
        lib,
        "Lena Ortiz",
      ),
    ).toBe("2 forms · sent when Lena joins");
    expect(
      checklistSummary(
        "repeating_form",
        [item({ refId: "s-weekly" })],
        lib,
        "Lena",
      ),
    ).toBe("Weekly · Sun 09:00 · 2 reminders");
    expect(
      checklistSummary(
        "repeating_form",
        [item({ refId: "gone" })],
        lib,
        "Lena",
      ),
    ).toBe("Check-in");
    expect(
      checklistSummary(
        "repeating_form",
        [item({ refId: "a" }), item({ refId: "b" })],
        lib,
        "Lena",
      ),
    ).toBe("2 check-ins");
    expect(
      checklistSummary(
        "nutrition_target",
        [
          item({
            config: { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 },
          }),
        ],
        lib,
        "Lena",
      ),
    ).toBe("2,100 kcal · 150 g protein");
    expect(checklistSummary("nutrition_target", [item()], lib, "Lena")).toBe(
      "Added",
    );
    expect(
      checklistSummary("meal_plan", [item({ refId: "p-train" })], lib, "Lena"),
    ).toBe("Training day meals");
    expect(
      checklistSummary("meal_plan", [item({ refId: "x" })], lib, "Lena"),
    ).toBe("1 plan");
    expect(checklistSummary("meal_plan", [item(), item()], lib, "Lena")).toBe(
      "2 plans",
    );
    expect(
      checklistSummary(
        "welcome_message",
        [item({ config: { text: "Hi Lena, excited to start the work" } })],
        lib,
        "Lena",
      ),
    ).toBe("“Hi Lena, excited to start…”");
    expect(checklistSummary("resource", [item()], lib, "Lena")).toBe("1 item");
  });

  it("summarises each section on the invited client's Overview", () => {
    expect(overviewSummary("meal_plan", [], lib)).toBe("Not added");
    expect(
      overviewSummary(
        "starter_form",
        [item({ refId: "f-goals" }), item({ refId: "f-life" })],
        lib,
      ),
    ).toBe("New client: goals and health · Lifestyle and schedule");
    expect(
      overviewSummary("repeating_form", [item({ refId: "s-weekly" })], lib),
    ).toBe("Sundays 09:00 · due Mon 12:00 · 2 reminders");
    expect(
      overviewSummary("repeating_form", [item({ refId: "gone" })], lib),
    ).toBe("Check-in");
    expect(
      overviewSummary(
        "nutrition_target",
        [
          item({
            config: { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 },
          }),
        ],
        lib,
      ),
    ).toBe("2,100 kcal · 150 g protein · 230 g carbs · 65 g fat");
    expect(overviewSummary("nutrition_target", [item()], lib)).toBe("Added");
    expect(
      overviewSummary(
        "meal_plan",
        [item({ refId: "p-train" }), item({ refId: "x" })],
        lib,
      ),
    ).toBe("Training day meals · Meal plan");
    expect(
      overviewSummary(
        "welcome_message",
        [item({ config: { text: "Hello" } })],
        lib,
      ),
    ).toBe("“Hello”");
    expect(overviewSummary("programme", [item()], lib)).toBe("1 item");
    expect(
      overviewTitle("repeating_form", [item({ refId: "s-weekly" })], lib),
    ).toBe("Weekly check-in");
    expect(overviewTitle("starter_form", [], lib)).toBe("Starter forms");
  });

  it("counts the checklist and reads items in order", () => {
    const d = detail({
      setup: {
        welcome_message: [item({ config: { text: "Hi" } })],
        starter_form: [
          item({ refId: "f-life", sortOrder: 1 }),
          item({ refId: "f-goals", sortOrder: 0 }),
        ],
      },
    });
    expect(itemsOf(d, "starter_form").map((i) => i.refId)).toEqual([
      "f-goals",
      "f-life",
    ]);
    expect(
      checklistCount(d, ["starter_form", "meal_plan", "welcome_message"]),
    ).toEqual({ done: 2, total: 3 });
  });

  it("looks things up in the library", () => {
    expect(formTitle(lib, "f-goals")).toBe("New client: goals and health");
    expect(formTitle(lib, null)).toBe("Form");
    expect(scheduleTitle(emptyLibrary(), "s")).toBe("Check-in");
    expect(formMeta(FORMS[0])).toBe("14 questions · about 7 min");
    expect(formMeta(undefined)).toBe("0 questions · about 1 min");
    expect(planMeta(PLANS[0])).toBe("5 meals · about 2,450 kcal");
    expect(planMeta(undefined)).toBe("");
    expect(questionTypeLabel("yes_no")).toBe("Yes / no");
    expect(questionTypeLabel("mystery")).toBe("mystery");
    expect(targetNumbers(undefined)).toBeNull();
    expect(targetNumbers(item({ config: { dailyKcal: 2000 } }))).toEqual({
      dailyKcal: 2000,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
    expect(buildLibrary(undefined, undefined, undefined).forms.size).toBe(0);
  });

  it("works out the invite's state, expiry included", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    expect(inviteState(null, now)).toBe("none");
    expect(
      inviteState({ status: "used", expiresAt: "2099-01-01T00:00:00Z" }, now),
    ).toBe("used");
    expect(
      inviteState(
        { status: "expired", expiresAt: "2099-01-01T00:00:00Z" },
        now,
      ),
    ).toBe("expired");
    expect(
      inviteState({ status: "active", expiresAt: "2026-11-23T11:59:00Z" }, now),
    ).toBe("expired");
    expect(
      inviteState({ status: "active", expiresAt: "2026-11-30T12:00:00Z" }, now),
    ).toBe("active");
    expect(summaryInviteState("not_sent", null, now)).toBe("none");
    expect(summaryInviteState("active", "2026-11-22T00:00:00Z", now)).toBe(
      "expired",
    );
    expect(summaryInviteState("active", null, now)).toBe("active");
    expect(daysLeft("2026-11-30T12:00:00Z", now)).toBe(7);
    expect(daysLeft("2026-11-23T13:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(daysLeft("nope", now)).toBe(0);
  });

  it("lists what the client gets when they accept", () => {
    const d = detail({
      setup: {
        welcome_message: [item({ config: { text: "Hi" } })],
        starter_form: [
          item({ refId: "f-goals" }),
          item({ refId: "f-life", sortOrder: 1 }),
        ],
        nutrition_target: [
          item({
            config: { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 },
          }),
        ],
        meal_plan: [
          item({ refId: "p-train" }),
          item({ refId: "missing", sortOrder: 1 }),
        ],
        repeating_form: [
          item({ refId: "s-weekly" }),
          item({ refId: "missing", sortOrder: 1 }),
        ],
      },
    });
    expect(readyLines(d, lib)).toEqual([
      "Your welcome message",
      "2 forms to fill in first",
      "Targets: 2,100 kcal · 150 g protein",
      "Training day meals",
      "A meal plan",
      "Weekly check-in, Sundays 09:00",
      "Check-in",
    ]);
    const dailyLib = buildLibrary(
      FORMS,
      [
        { ...weekly, id: "d", trigger: "daily", weekday: null },
        { ...weekly, id: "o", trigger: "once", weekday: null, timeLocal: null },
      ],
      [],
    );
    expect(
      readyLines(
        detail({
          setup: {
            repeating_form: [
              item({ refId: "d" }),
              item({ refId: "o", sortOrder: 1 }),
            ],
          },
        }),
        dailyLib,
      ),
    ).toEqual(["Weekly check-in, daily 09:00", "Weekly check-in, once"]);
    expect(readyLines(detail(), lib)).toEqual([]);
  });

  it("writes the invite email", () => {
    const href = inviteMailto({
      email: "lena@example.com",
      clientFirst: "Lena",
      coachName: "Ellie Hart",
      code: "LN4Q8T",
      link: "persistencemobile://accept-invite?code=LN4Q8T",
      days: 7,
    });
    expect(href.startsWith("mailto:lena%40example.com?subject=")).toBe(true);
    const body = decodeURIComponent(href.split("&body=")[1]);
    expect(body).toContain("LN4Q8T");
    expect(body).toContain("The code works for 7 days.");
    expect(
      decodeURIComponent(
        inviteMailto({
          email: "a@b.co",
          clientFirst: "A",
          coachName: "C",
          code: "X",
          link: "l",
          days: 1,
        }),
      ),
    ).toContain("1 more day");
  });
});

describe("drafts", () => {
  it("compares items regardless of key order and sort numbers", () => {
    expect(
      sameItems(
        [item({ config: { a: 1, b: { c: [1] } } })],
        [item({ config: { b: { c: [1] }, a: 1 }, sortOrder: 9 })],
      ),
    ).toBe(true);
    expect(sameItems([item({ refId: "a" })], [item({ refId: "b" })])).toBe(
      false,
    );
  });

  it("refuses a half-filled target", () => {
    expect(draftError("nutrition_target", [])).toBeNull();
    expect(
      draftError("nutrition_target", [
        item({
          config: { dailyKcal: 2000, proteinG: 150, carbsG: null, fatG: 60 },
        }),
      ]),
    ).toMatch(/Enter calories/);
    expect(
      draftError("nutrition_target", [
        item({ config: { dailyKcal: 30000, proteinG: 1, carbsG: 1, fatG: 1 } }),
      ]),
    ).toMatch(/Enter/);
    expect(
      draftError("nutrition_target", [
        item({ config: { dailyKcal: 2000, proteinG: 1, carbsG: 1, fatG: 1 } }),
      ]),
    ).toBeNull();
    expect(
      draftError("welcome_message", [
        item({ config: { text: "x".repeat(1001) } }),
      ]),
    ).toMatch(/1,000/);
    expect(
      draftError("welcome_message", [item({ config: { text: "ok" } })]),
    ).toBeNull();
  });

  it("trims the welcome message and renumbers items", () => {
    expect(
      itemsToSave("welcome_message", [item({ config: { text: "  Hi  " } })]),
    ).toEqual([{ refId: null, sortOrder: 0, config: { text: "Hi" } }]);
    expect(
      itemsToSave("welcome_message", [item({ config: { text: "   " } })]),
    ).toEqual([]);
    expect(
      itemsToSave("meal_plan", [item({ refId: "a", sortOrder: 5 })]),
    ).toEqual([{ refId: "a", sortOrder: 0, config: {} }]);
  });
});

describe("declaration", () => {
  it("asks when the accepted version isn't the current one", () => {
    expect(
      needsDeclaration({ currentVersion: "v2", acceptedVersion: "v1" }),
    ).toBe(true);
    expect(
      needsDeclaration({ currentVersion: "v2", acceptedVersion: null }),
    ).toBe(true);
    expect(
      needsDeclaration({ currentVersion: "v2", acceptedVersion: "v2" }),
    ).toBe(false);
  });

  it("hashes the exact text with SHA-256", async () => {
    expect(declarationText()).toContain("PAR-Q");
    const hash = await declarationTextHash("abc");
    expect(hash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("settings", () => {
  it("starts a training target at three a week", () => {
    expect(trainingPatch(settings(), true)).toEqual({
      trackTraining: true,
      sessionsPerWeek: 3,
    });
    expect(trainingPatch(settings({ sessionsPerWeek: 5 }), true)).toEqual({
      trackTraining: true,
    });
    expect(trainingPatch(settings(), false)).toEqual({ trackTraining: false });
    expect(clampSessions(0)).toBe(1);
    expect(clampSessions(20)).toBe(14);
  });

  it("applies a patch for the optimistic update", () => {
    const next = applyPatch(settings(), {
      trackTraining: true,
      trackCalories: false,
      sessionsPerWeek: 4,
      alertMode: "mute",
      features: { photos: false },
    });
    expect(next).toMatchObject({
      trackTraining: true,
      trackCalories: false,
      sessionsPerWeek: 4,
      alertMode: "mute",
    });
    expect(next.features.photos).toBe(false);
    expect(next.features.messages).toBe(true);
    expect(applyPatch(settings(), {})).toEqual(settings());
  });
});

describe("who form", () => {
  it("turns the form into profile fields", () => {
    expect(
      toInput({ first: "", last: "", contact: "x", goal: "", notes: "" }),
    ).toEqual({
      ok: false,
      errors: {
        first: "Add a first name.",
        contact: "Enter an email address or a mobile number.",
      },
    });
    expect(
      toInput({
        first: "Lena",
        last: "Ortiz",
        contact: "07700 900123",
        goal: " ",
        notes: "n",
      }),
    ).toEqual({
      ok: true,
      input: {
        displayName: "Lena Ortiz",
        contactEmail: null,
        contactPhone: "07700 900123",
        goal: null,
        privateNotes: "n",
      },
    });
  });

  it("round-trips a profile and patches only what changed", () => {
    const p = detail();
    expect(valuesFrom(p)).toEqual({
      first: "Lena",
      last: "Ortiz",
      contact: "lena.ortiz@example.com",
      goal: "First pull-up, then a strength base",
      notes: "Desk job, left shoulder tight.",
    });
    expect(valuesFrom({ ...p, goal: null, privateNotes: null }).goal).toBe("");
    expect(
      changedFields(p, {
        displayName: "Lena Ortiz",
        contactEmail: "lena.ortiz@example.com",
        contactPhone: null,
        goal: "Run 5k",
        privateNotes: "Desk job, left shoulder tight.",
      }),
    ).toEqual({ goal: "Run 5k" });
  });
});
