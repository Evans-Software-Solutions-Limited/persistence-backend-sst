import type { Resolver } from "react-hook-form";
import {
  CONTACT_MESSAGE,
  EMPTY_WHO,
  NAME_MESSAGE,
  SESSIONS_MESSAGE,
  TARGETS_MESSAGE,
  WELCOME_MESSAGE,
  changedProfileFields,
  declarationResolver,
  prepareSetup,
  settingsResolver,
  setupResolver,
  toProfileFields,
  whoResolver,
  whoValuesFrom,
  type SetupFormValues,
  type WhoValues,
} from "@/ui/forms/clientProfileForms";
import { firstMessage, messageAt } from "@/shared/form";
import { swapIdInRow } from "@/adapters/storage/coachClientProfilesSwap";
import type { ClientProfile } from "@/domain/models/coachClientProfiles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<V extends Record<string, any>>(
  resolver: Resolver<V>,
  values: V,
) {
  return resolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  } as never);
}

const who = (patch: Partial<WhoValues>): WhoValues => ({
  ...EMPTY_WHO,
  first: "Lena",
  ...patch,
});

describe("Who (C11f)", () => {
  it("needs a first name and checks the contact as an email or mobile", async () => {
    expect(messageAt((await run(whoResolver, EMPTY_WHO)).errors, "first")).toBe(
      "Add a first name.",
    );
    expect(
      (await run(whoResolver, who({ contact: "lena@example.com" }))).errors,
    ).toEqual({});
    expect(
      (await run(whoResolver, who({ contact: "+44 7700 900123" }))).errors,
    ).toEqual({});
    expect(
      messageAt(
        (await run(whoResolver, who({ contact: "lena@" }))).errors,
        "contact",
      ),
    ).toBe(CONTACT_MESSAGE);
  });

  it("checks the joined name against the API's 80 characters", async () => {
    const long = "x".repeat(60);
    expect(
      messageAt(
        (await run(whoResolver, who({ first: long, last: long }))).errors,
        "last",
      ),
    ).toBe(NAME_MESSAGE);
    expect(
      messageAt(
        (await run(whoResolver, who({ first: "y".repeat(81) }))).errors,
        "first",
      ),
    ).toBe(NAME_MESSAGE);
  });

  it("maps form values to profile fields and back, sending only changes", () => {
    const fields = toProfileFields(
      who({
        last: " Ortiz ",
        contact: "0770 090 0123",
        goal: " ",
        notes: "Knee",
      }),
    );
    expect(fields).toEqual({
      displayName: "Lena Ortiz",
      contactEmail: null,
      contactPhone: "0770 090 0123",
      goal: null,
      privateNotes: "Knee",
    });
    expect(toProfileFields(who({ contact: "a@b.co" })).contactEmail).toBe(
      "a@b.co",
    );
    const before = {
      displayName: "Lena Ortiz",
      contactEmail: null,
      contactPhone: "0770 090 0123",
      goal: "Old",
      privateNotes: null,
    } as ClientProfile;
    expect(whoValuesFrom(before)).toEqual({
      first: "Lena",
      last: "Ortiz",
      contact: "0770 090 0123",
      goal: "Old",
      notes: "",
    });
    expect(changedProfileFields(before, fields)).toEqual({
      goal: null,
      privateNotes: "Knee",
    });
  });
});

const setup = (patch: Partial<SetupFormValues>): SetupFormValues => ({
  section: "starter_form",
  items: [],
  ...patch,
});

describe("set-up sections (C11l–r)", () => {
  it("targets need calories and all three macros within the API's limits", async () => {
    const values = setup({
      section: "nutrition_target",
      items: [
        {
          refId: null,
          sortOrder: 0,
          config: { dailyKcal: 2100, proteinG: null, carbsG: 1, fatG: 1 },
        },
      ],
    });
    expect(firstMessage((await run(setupResolver, values)).errors)).toBe(
      TARGETS_MESSAGE,
    );
    values.items[0]!.config = {
      dailyKcal: 2100,
      proteinG: 150,
      carbsG: 230,
      fatG: 65,
    };
    expect((await run(setupResolver, values)).errors).toEqual({});
    values.items[0]!.config.dailyKcal = 30_000;
    expect(firstMessage((await run(setupResolver, values)).errors)).toBe(
      TARGETS_MESSAGE,
    );
  });

  it("the welcome message is checked once trimmed (and empty is none)", async () => {
    const long = setup({
      section: "welcome_message",
      items: [
        { refId: null, sortOrder: 0, config: { text: "x".repeat(1001) } },
      ],
    });
    expect(firstMessage((await run(setupResolver, long)).errors)).toBe(
      WELCOME_MESSAGE,
    );
    const padded = setup({
      section: "welcome_message",
      items: [
        {
          refId: null,
          sortOrder: 0,
          config: { text: ` ${"x".repeat(1000)} ` },
        },
      ],
    });
    expect((await run(setupResolver, padded)).errors).toEqual({});
    expect(
      prepareSetup(
        setup({
          section: "welcome_message",
          items: [{ refId: null, sortOrder: 0, config: { text: "  " } }],
        }),
      ).items,
    ).toEqual([]);
  });

  it("pickers cap their items; a null check-in override counts as none", async () => {
    const many = setup({
      section: "meal_plan",
      items: Array.from({ length: 11 }, (_, i) => ({
        refId: `p${i}`,
        sortOrder: i,
        config: {},
      })),
    });
    expect(firstMessage((await run(setupResolver, many)).errors)).toBeTruthy();
    const checkin = setup({
      section: "repeating_form",
      items: [
        { refId: "s1", sortOrder: 0, config: { override: null } },
        {
          refId: "s2",
          sortOrder: 1,
          config: { override: { timeLocal: "07:30" } },
        },
      ],
    });
    expect((await run(setupResolver, checkin)).errors).toEqual({});
    expect(prepareSetup(checkin).items[0]!.config).toEqual({});
    expect(prepareSetup(setup({ items: [] }))).toEqual(setup({ items: [] }));
  });
});

describe("C3.9 settings and the declaration", () => {
  it("sessions a week are 1–14 or none", async () => {
    const base = {
      trackTraining: true,
      trackCalories: false,
      sessionsPerWeek: 15 as number | null,
      alertMode: "default" as const,
      features: {
        messages: true,
        checkIns: true,
        photos: true,
        habits: true,
        nutrition: true,
        resources: true,
      },
    };
    expect(
      messageAt((await run(settingsResolver, base)).errors, "sessionsPerWeek"),
    ).toBe(SESSIONS_MESSAGE);
    expect(
      (await run(settingsResolver, { ...base, sessionsPerWeek: null })).errors,
    ).toEqual({});
  });

  it("the declaration needs the tick", async () => {
    expect(
      messageAt(
        (await run(declarationResolver, { agreed: false })).errors,
        "agreed",
      ),
    ).toBe("Tick the box to confirm.");
    expect((await run(declarationResolver, { agreed: true })).errors).toEqual(
      {},
    );
  });
});

describe("queue row swap", () => {
  it("swaps a local id in entity id, endpoint and payload; skips rows without it", () => {
    const row = {
      entityId: "u:local-1:resource",
      endpoint: "/trainers/me/client-profiles/local-1/setup/resource",
      payload: '{"items":[]}',
    };
    expect(swapIdInRow(row, "local-1", "p-1")).toEqual({
      entityId: "u:p-1:resource",
      endpoint: "/trainers/me/client-profiles/p-1/setup/resource",
      payload: '{"items":[]}',
    });
    expect(swapIdInRow(row, "local-2", "p-2")).toBeNull();
    expect(swapIdInRow(row, "local-1", "local-1")).toBeNull();
    expect(
      swapIdInRow({ ...row, entityId: null }, "local-1", "p-1")?.entityId,
    ).toBeNull();
  });
});
