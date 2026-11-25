import { describe, expect, it } from "vitest";
import type { FieldValues, Resolver } from "react-hook-form";
import { firstMessage, messageAt } from "@/lib/form";
import { draftError } from "../lib/draft";
import { clientRuleResolver, sendResolver } from "../lib/ruleForm";
import { replyResolver } from "../lib/replyForm";
import { settingsResolver } from "../lib/settingsForm";
import {
  TARGETS_MESSAGE,
  WELCOME_MESSAGE,
  setupProblem,
  setupResolver,
  setupServerFields,
} from "../lib/setupForm";
import { EMPTY, whoResolver } from "../lib/whoForm";
import type { EffectiveRule } from "../lib/schedule";

/**
 * Each form's react-hook-form rules (PER-147): the same messages as before
 * the move, from the TypeBox schema through the resolver.
 */
// As react-hook-form calls it in the app: no registered fields, so `names`
// is empty (Inspector Brad, #561).
const opts = {
  fields: {},
  names: [] as string[],
  shouldUseNativeValidation: false,
} as const;
async function errorsOf<V extends FieldValues>(
  resolver: Resolver<V>,
  values: V,
) {
  return (await resolver(values, undefined, opts as never)).errors;
}

const weekly: EffectiveRule = {
  trigger: "weekly",
  weekday: 7,
  timeLocal: "09:00",
  dueAfterHours: 27,
  reminders: [{ afterHours: 9 }],
};

describe("Who (C11a)", () => {
  it("needs a first name and a real email or mobile", async () => {
    const e = await errorsOf(whoResolver, {
      ...EMPTY,
      first: "  ",
      contact: "x",
    });
    expect(messageAt(e, "first")).toBe("Add a first name.");
    expect(messageAt(e, "contact")).toBe(
      "Enter an email address or a mobile number.",
    );
    expect(
      messageAt(
        await errorsOf(whoResolver, { ...EMPTY, first: "L", contact: "a@b" }),
        "contact",
      ),
    ).toBeDefined();
  });

  it("passes a name alone, an email or a phone, trimmed", async () => {
    for (const contact of ["", " lena@example.com ", "+44 7700 900123"]) {
      expect(
        await errorsOf(whoResolver, { ...EMPTY, first: "Lena", contact }),
      ).toEqual({});
    }
    expect(
      messageAt(
        await errorsOf(whoResolver, {
          ...EMPTY,
          first: "L",
          goal: "g".repeat(201),
        }),
        "goal",
      ),
    ).toBe("Keep the goal under 200 characters.");
  });
});

describe("Who: the name as the API limits it (joined, 1–80)", () => {
  it("reopens a saved name whatever its split, and limits the whole", async () => {
    // A saved 70-character name reopens with every later word in Last name.
    const last =
      "de la Cruz Fernández-Rodríguez y Montenegro Villaseñor Ortega";
    expect(last.length).toBeGreaterThan(40);
    expect(
      await errorsOf(whoResolver, { ...EMPTY, first: "María", last }),
    ).toEqual({});
    // One long first word is a name, not a missing one.
    expect(
      await errorsOf(whoResolver, { ...EMPTY, first: "x".repeat(45) }),
    ).toEqual({});
    const long = await errorsOf(whoResolver, {
      ...EMPTY,
      first: "Lena",
      last: "y".repeat(80),
    });
    expect(messageAt(long, "last")).toBe("Keep the name to 80 characters.");
    expect(messageAt(long, "first")).toBeUndefined();
    expect(
      messageAt(
        await errorsOf(whoResolver, { ...EMPTY, first: "z".repeat(81) }),
        "first",
      ),
    ).toBe("Keep the name to 80 characters.");
  });
});

describe("Set up (C11b)", () => {
  const target = (config: Record<string, unknown>) => [
    { refId: null, sortOrder: 0, config },
  ];

  it("targets need calories and all three macros in range", async () => {
    const e = await errorsOf(setupResolver, {
      section: "nutrition_target",
      items: target({ dailyKcal: 2000, proteinG: null }),
    });
    expect(firstMessage(e)).toBe(TARGETS_MESSAGE);
    expect(
      setupProblem(
        "nutrition_target",
        target({ dailyKcal: 20_001, proteinG: 1, carbsG: 1, fatG: 1 }),
      ),
    ).toBe(TARGETS_MESSAGE);
    expect(
      setupProblem(
        "nutrition_target",
        target({ dailyKcal: 2000, proteinG: 150, carbsG: 200, fatG: 70 }),
      ),
    ).toBeNull();
    expect(setupProblem("nutrition_target", [])).toBeNull();
  });

  it("the welcome message is checked trimmed", async () => {
    const long = target({ text: "x".repeat(1001) });
    expect(draftError("welcome_message", long)).toBe(WELCOME_MESSAGE);
    expect(
      draftError("welcome_message", target({ text: ` ${"x".repeat(1000)} ` })),
    ).toBeNull();
    expect(
      await errorsOf(setupResolver, {
        section: "welcome_message",
        items: target({}),
      }),
    ).toEqual({});
  });

  it("pickers take refs; a check-in override is checked", async () => {
    expect(
      setupProblem("starter_form", [{ refId: "f1", sortOrder: 0, config: {} }]),
    ).toBeNull();
    expect(
      setupProblem("repeating_form", [
        {
          refId: "s1",
          sortOrder: 0,
          config: { override: { timeLocal: "25:00" } },
        },
      ]),
    ).toBe("Choose a time to send it.");
    expect(
      setupProblem("repeating_form", [
        { refId: "s1", sortOrder: 0, config: { override: null } },
      ]),
    ).toBeNull();
  });

  it("a 422 lands on the section's own message", () => {
    expect(setupServerFields("nutrition_target").items!.message).toBe(
      TARGETS_MESSAGE,
    );
    expect(setupServerFields("welcome_message").items!.message).toBe(
      WELCOME_MESSAGE,
    );
    expect(setupServerFields("meal_plan")).toEqual({});
  });
});

describe("Send rules (C10c, C10j)", () => {
  it("a weekly rule needs a day and a time; daily needs a time", async () => {
    let e = await errorsOf(clientRuleResolver, {
      ...weekly,
      weekday: null,
      timeLocal: null,
    });
    expect(messageAt(e, "weekday")).toBe("Choose a day to send it.");
    expect(messageAt(e, "timeLocal")).toBe("Choose a time to send it.");
    e = await errorsOf(clientRuleResolver, {
      ...weekly,
      trigger: "daily",
      weekday: null,
      timeLocal: null,
    });
    expect(Object.keys(e)).toEqual(["timeLocal"]);
    e = await errorsOf(clientRuleResolver, {
      ...weekly,
      dueAfterHours: 0,
      reminders: Array(6).fill({ afterHours: 1 }),
    });
    expect(messageAt(e, "dueAfterHours")).toBe("Choose when it's due.");
    expect(messageAt(e, "reminders")).toBe("Check the reminders.");
    expect(await errorsOf(clientRuleResolver, weekly)).toEqual({});
  });

  it("sending to selected clients needs one; all or join forms don't", async () => {
    const e = await errorsOf(sendResolver, {
      all: false,
      clientIds: [],
      rule: weekly,
    });
    expect(messageAt(e, "clientIds")).toBe("Add at least one client.");
    expect(
      await errorsOf(sendResolver, { all: true, clientIds: [], rule: weekly }),
    ).toEqual({});
    expect(
      await errorsOf(sendResolver, {
        all: false,
        clientIds: [],
        rule: { ...weekly, trigger: "on_join", weekday: null, timeLocal: null },
      }),
    ).toEqual({});
    expect(
      messageAt(
        await errorsOf(sendResolver, {
          all: true,
          clientIds: [],
          rule: { ...weekly, timeLocal: "9am" },
        }),
        "rule.timeLocal",
      ),
    ).toBe("Choose a time to send it.");
  });
});

describe("Settings (C3.9) and reply (C3.3)", () => {
  const settings = {
    trackTraining: true,
    trackCalories: false,
    sessionsPerWeek: 3 as number | null,
    alertMode: "default" as const,
    features: { messages: true },
  };

  it("sessions a week are 1 to 14, or none (as the API allows)", async () => {
    expect(await errorsOf(settingsResolver, settings as never)).toEqual({});
    for (const sessionsPerWeek of [0, 15, 2.5]) {
      expect(
        messageAt(
          await errorsOf(settingsResolver, {
            ...settings,
            sessionsPerWeek,
          } as never),
          "sessionsPerWeek",
        ),
      ).toBe("Choose 1 to 14 sessions a week.");
    }
    // Training on with no target yet (a set-up with a programme, accepted)
    // is valid, so the client's other switches still save.
    for (const trackTraining of [true, false]) {
      expect(
        await errorsOf(settingsResolver, {
          ...settings,
          trackTraining,
          sessionsPerWeek: null,
        } as never),
      ).toEqual({});
    }
  });

  it("a reply has words and fits 2,000 characters", async () => {
    expect(
      messageAt(await errorsOf(replyResolver, { reply: "  " }), "reply"),
    ).toBe("Write a reply.");
    expect(
      messageAt(
        await errorsOf(replyResolver, { reply: "x".repeat(2001) }),
        "reply",
      ),
    ).toBe("Keep the reply under 2,000 characters.");
    expect(await errorsOf(replyResolver, { reply: " Great week " })).toEqual(
      {},
    );
  });
});
