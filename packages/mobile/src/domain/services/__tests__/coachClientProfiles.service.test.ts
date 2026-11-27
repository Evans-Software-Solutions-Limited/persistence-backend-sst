import {
  applySettingsPatch,
  buildSetupLibrary,
  checklistCount,
  checklistSummary,
  clampSessions,
  contactOf,
  daysLeft,
  expiresLine,
  firstName,
  formMeta,
  inviteShareMessage,
  inviteState,
  itemsOf,
  joinName,
  mergeSettingsPatch,
  overrideFrom,
  parseContact,
  planMeta,
  profileInitials,
  programmeMeta,
  readyRows,
  renumber,
  resourceKind,
  ruleFor,
  ruleShort,
  ruleSummary,
  scheduleTitle,
  splitName,
  targetNumbers,
  trainingPatch,
  welcomeText,
} from "@/domain/services/coachClientProfiles.service";
import type {
  ClientSettings,
  SetupItem,
} from "@/domain/models/coachClientProfiles";
import type { CoachForm, FormSchedule } from "@/domain/models/coachForms";

const form = (id: string, title: string, n: number): CoachForm => ({
  id,
  title,
  description: null,
  templateKey: null,
  available: true,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  version: {
    id: `${id}-v`,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    questions: Array.from({ length: n }, (_, i) => ({
      id: `q${i}`,
      type: "short_text" as const,
      prompt: `Q${i}`,
      required: true,
    })),
  },
});

const weekly: FormSchedule = {
  id: "s-week",
  formId: "f-week",
  trigger: "weekly",
  audience: "selected",
  weekday: 7,
  timeLocal: "09:00",
  dueAfterHours: 27,
  reminders: [{ afterHours: 9 }, { afterHours: 24 }],
  status: "active",
  revision: 1,
  clients: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const lib = buildSetupLibrary({
  forms: [
    form("f-join", "New client: goals and health", 14),
    form("f-week", "Weekly check-in", 12),
  ],
  schedules: [
    weekly,
    {
      ...weekly,
      id: "s-daily",
      trigger: "daily",
      weekday: null,
      timeLocal: "08:00",
      reminders: [],
    },
  ],
  programmes: [
    {
      id: "pr1",
      name: "Lean bulk · Upper / Lower",
      description: null,
      durationWeeks: 12,
      daysPerWeek: 4,
      workoutCount: 48,
      activeClientCount: 0,
      createdAt: null,
      updatedAt: null,
    },
  ],
  plans: [
    {
      id: "pl1",
      name: "Training day meals",
      totals: { kcal: 2450, proteinG: 0, carbsG: 0, fatG: 0 },
      meals: [1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, name: `M${i}` })),
    },
  ],
  resources: [
    {
      id: "r1",
      kind: "file",
      title: "Squat depth",
      mime: "video/mp4",
      bytes: 1,
      archivedAt: null,
    },
  ],
});

const item = (
  refId: string | null,
  config: Record<string, unknown> = {},
  sortOrder = 0,
): SetupItem => ({
  refId,
  config,
  sortOrder,
});

describe("names and contact", () => {
  it("joins, splits and abbreviates names", () => {
    expect(joinName(" Lena ", " Ortiz ")).toBe("Lena Ortiz");
    expect(joinName("Lena", "")).toBe("Lena");
    expect(splitName("Lena  van Ortiz")).toEqual({
      first: "Lena",
      last: "van Ortiz",
    });
    expect(splitName("  ")).toEqual({ first: "", last: "" });
    expect(firstName("Lena Ortiz")).toBe("Lena");
    expect(firstName("")).toBe("your client");
    expect(profileInitials("Lena van Ortiz")).toBe("LO");
    expect(profileInitials("Lena")).toBe("L");
    expect(profileInitials(" ")).toBe("?");
  });

  it("reads the one contact field as an email or a mobile", () => {
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
    expect(parseContact("12")).toEqual({ kind: "invalid" });
    expect(contactOf({ contactEmail: null, contactPhone: "0770" })).toBe(
      "0770",
    );
    expect(contactOf({ contactEmail: null, contactPhone: null })).toBe("");
  });
});

describe("set-up summaries (C11g, C11i)", () => {
  const detail = {
    setup: {
      starter_form: [item("f-join", {}, 1), item("f-week", {}, 0)],
      repeating_form: [item("s-week")],
      programme: [item("pr1")],
      nutrition_target: [
        item(null, { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 }),
      ],
      resource: [item("r1"), item("r2", {}, 1)],
      welcome_message: [
        item(null, { text: "Hi Lena, excited to start. Fill in the forms." }),
      ],
    },
  };

  it("sorts items and renumbers", () => {
    expect(itemsOf(detail, "starter_form").map((i) => i.refId)).toEqual([
      "f-week",
      "f-join",
    ]);
    expect(
      renumber([item("a", {}, 5), item("b", {}, 9)]).map((i) => i.sortOrder),
    ).toEqual([0, 1]);
  });

  it("writes each checklist line as the canvas does", () => {
    const s = (section: Parameters<typeof checklistSummary>[0]) =>
      checklistSummary(section, itemsOf(detail, section), lib, "Lena Ortiz");
    expect(s("starter_form")).toBe("2 forms · sent when Lena joins");
    expect(s("repeating_form")).toBe("Weekly · Sun 09:00 · 2 reminders");
    expect(s("programme")).toBe("Lean bulk · Upper / Lower");
    expect(s("nutrition_target")).toBe("2,100 kcal · 150 g protein");
    expect(s("meal_plan")).toBe("Not added");
    expect(s("resource")).toBe("2 resources");
    expect(s("welcome_message")).toBe("“Hi Lena, excited to start…”");
    expect(checklistCount(detail)).toEqual({ done: 6, total: 7 });
  });

  it("falls back when the library doesn't know an item", () => {
    const empty = buildSetupLibrary({});
    expect(checklistSummary("repeating_form", [item("x")], empty, "L")).toBe(
      "Check-in",
    );
    expect(
      checklistSummary("repeating_form", [item("x"), item("y")], empty, "L"),
    ).toBe("2 check-ins");
    expect(checklistSummary("programme", [item("x")], empty, "L")).toBe(
      "1 programme",
    );
    expect(
      checklistSummary("programme", [item("x"), item("y")], empty, "L"),
    ).toBe("2 programmes");
    expect(checklistSummary("meal_plan", [item("x")], empty, "L")).toBe(
      "1 plan",
    );
    expect(
      checklistSummary("meal_plan", [item("x"), item("y")], empty, "L"),
    ).toBe("2 plans");
    expect(checklistSummary("meal_plan", [item("pl1")], lib, "L")).toBe(
      "Training day meals",
    );
    expect(
      checklistSummary("nutrition_target", [item(null, {})], empty, "L"),
    ).toBe("Added");
    expect(scheduleTitle(empty, null)).toBe("Check-in");
    expect(welcomeText(item(null, { text: 3 }))).toBe("");
  });

  it("lists what's ready on the invited client", () => {
    expect(readyRows(detail, lib)).toEqual([
      { section: "starter_form", title: "Starter forms", sub: "2 forms" },
      {
        section: "repeating_form",
        title: "Weekly check-in",
        sub: "Sun 09:00 · 2 reminders",
      },
      {
        section: "programme",
        title: "Programme",
        sub: "Lean bulk · Upper / Lower",
      },
      {
        section: "nutrition_target",
        title: "Targets",
        sub: "2,100 kcal · 150 g protein",
      },
      { section: "resource", title: "Resources", sub: "2 resources" },
      {
        section: "welcome_message",
        title: "Welcome message",
        sub: "Ready to send",
      },
    ]);
    expect(
      readyRows({ setup: { repeating_form: [item("a"), item("b")] } }, lib)[0],
    ).toEqual({
      section: "repeating_form",
      title: "Check-ins",
      sub: "2 check-ins",
    });
  });

  it("formats library rows", () => {
    expect(formMeta(lib.forms.get("f-join"))).toBe(
      "14 questions · about 7 min",
    );
    expect(formMeta(undefined)).toBe("0 questions · about 1 min");
    expect(planMeta(lib.plans.get("pl1"))).toBe("5 meals · about 2,450 kcal");
    expect(planMeta(undefined)).toBe("");
    expect(programmeMeta(lib.programmes.get("pr1"))).toBe(
      "12 weeks · 4 workouts a week · 48 workouts",
    );
    expect(programmeMeta(undefined)).toBe("");
    expect(resourceKind(lib.resources.get("r1"))).toBe("Video");
    expect(
      resourceKind({
        id: "x",
        kind: "link",
        title: "",
        mime: null,
        bytes: null,
        archivedAt: null,
      }),
    ).toBe("Link");
    expect(
      resourceKind({
        id: "x",
        kind: "file",
        title: "",
        mime: "application/pdf",
        bytes: null,
        archivedAt: null,
      }),
    ).toBe("PDF");
    expect(
      resourceKind({
        id: "x",
        kind: "file",
        title: "",
        mime: "image/png",
        bytes: null,
        archivedAt: null,
      }),
    ).toBe("Image");
    expect(
      resourceKind({
        id: "x",
        kind: "file",
        title: "",
        mime: null,
        bytes: null,
        archivedAt: null,
      }),
    ).toBe("File");
    expect(resourceKind(undefined)).toBe("Resource");
  });

  it("reads targets only when calories are set", () => {
    expect(targetNumbers(undefined)).toBeNull();
    expect(targetNumbers(item(null, { proteinG: 1 }))).toBeNull();
    expect(targetNumbers(item(null, { dailyKcal: 2000 }))).toEqual({
      dailyKcal: 2000,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });
});

describe("check-in rules", () => {
  it("applies the item's override and keeps only differences", () => {
    const rule = ruleFor(weekly, { timeLocal: "07:30", reminders: [] });
    expect(rule).toMatchObject({
      weekday: 7,
      timeLocal: "07:30",
      reminders: [],
    });
    expect(ruleFor(weekly, null).timeLocal).toBe("09:00");
    expect(ruleFor(weekly, { dueAfterHours: null }).dueAfterHours).toBeNull();
    expect(overrideFrom(weekly, ruleFor(weekly, null))).toBeNull();
    expect(
      overrideFrom(weekly, {
        weekday: 1,
        timeLocal: "07:00",
        dueAfterHours: 12,
        reminders: [{ afterHours: 2 }],
      }),
    ).toEqual({
      weekday: 1,
      timeLocal: "07:00",
      dueAfterHours: 12,
      reminders: [{ afterHours: 2 }],
    });
  });

  it("summarises once, weekly and daily rules", () => {
    expect(ruleSummary({ ...weekly, trigger: "once", reminders: [] })).toBe(
      "Once",
    );
    expect(ruleSummary({ ...weekly, trigger: "daily", reminders: [] })).toBe(
      "Daily · 09:00",
    );
    expect(ruleShort({ ...weekly, trigger: "once", reminders: [] })).toBe(
      "Once",
    );
    expect(ruleShort({ ...weekly, trigger: "on_join", reminders: [] })).toBe(
      "Check-in",
    );
  });
});

describe("invite state", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  it("tells active, expired, used and none apart", () => {
    expect(inviteState(null, now)).toBe("none");
    expect(inviteState({ status: "used", expiresAt: "" }, now)).toBe("used");
    expect(inviteState({ status: "expired", expiresAt: "" }, now)).toBe(
      "expired",
    );
    expect(
      inviteState({ status: "active", expiresAt: "2026-11-27T11:00:00Z" }, now),
    ).toBe("expired");
    expect(
      inviteState({ status: "active", expiresAt: "2026-12-04T12:00:00Z" }, now),
    ).toBe("active");
  });

  it("counts whole days left and writes the share message", () => {
    expect(daysLeft("2026-12-04T12:00:00Z", now)).toBe(7);
    expect(daysLeft("nope", now)).toBe(0);
    expect(daysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(expiresLine(0)).toBe("expires today");
    expect(expiresLine(1)).toBe("expires in 1 day");
    expect(expiresLine(7)).toBe("expires in 7 days");
    expect(
      inviteShareMessage({
        clientFirst: "Lena",
        code: "LN4Q8T",
        link: "https://x/LN4Q8T",
      }),
    ).toBe(
      "Hi Lena, join me on Persistence: use code LN4Q8T or tap https://x/LN4Q8T",
    );
  });
});

describe("C3.9 settings", () => {
  const settings: ClientSettings = {
    relationshipId: "rel",
    clientId: "c1",
    trackTraining: false,
    trackCalories: false,
    sessionsPerWeek: null,
    features: {
      messages: true,
      checkIns: true,
      photos: true,
      habits: true,
      nutrition: true,
      resources: true,
    },
    alertMode: "default",
    revision: 3,
    updatedAt: null,
  };

  it("starts a training target at three a week", () => {
    expect(trainingPatch(settings, true)).toEqual({
      trackTraining: true,
      sessionsPerWeek: 3,
    });
    expect(trainingPatch({ sessionsPerWeek: 5 }, true)).toEqual({
      trackTraining: true,
    });
    expect(trainingPatch(settings, false)).toEqual({ trackTraining: false });
    expect(clampSessions(0)).toBe(1);
    expect(clampSessions(20)).toBe(14);
  });

  it("applies and merges patches", () => {
    const next = applySettingsPatch(settings, {
      trackCalories: true,
      trackTraining: true,
      sessionsPerWeek: 4,
      alertMode: "mute",
      features: { photos: false },
    });
    expect(next).toMatchObject({
      trackCalories: true,
      trackTraining: true,
      sessionsPerWeek: 4,
      alertMode: "mute",
    });
    expect(next.features.photos).toBe(false);
    expect(applySettingsPatch(settings, {})).toEqual(settings);
    expect(
      mergeSettingsPatch(
        { features: { photos: false }, alertMode: "mute" },
        { features: { habits: false } },
      ),
    ).toEqual({
      alertMode: "mute",
      features: { photos: false, habits: false },
    });
    expect(
      mergeSettingsPatch({ trackCalories: true }, { trackCalories: false }),
    ).toEqual({ trackCalories: false });
  });
});
