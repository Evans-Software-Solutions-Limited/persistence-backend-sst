import {
  CLIENT_PROFILE_LIMITS,
  CLIENT_SETTINGS_LIMITS,
  CLIENT_SETUP_LIMITS,
} from "@persistence/form-limits";
import { Type, type TObject } from "@sinclair/typebox";
import type { Resolver } from "react-hook-form";
import { schemaResolver, trimmed, type ServerFieldMap } from "@/shared/form";
import type {
  AlertMode,
  ClientProfile,
  ClientSettings,
  FeatureKey,
  ProfileFields,
  SetupItem,
  SetupSection,
} from "@/domain/models/coachClientProfiles";
import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  contactOf,
  joinName,
  parseContact,
  splitName,
  welcomeText,
} from "@/domain/services/coachClientProfiles.service";
import { ruleFieldsSchema } from "./ruleForms";

/**
 * PER-125 (APP-A2): the iPhone add-client flow and C3.9 on react-hook-form,
 * with the same rules (and copy) as the web workspace's (PER-147): limits
 * from `@persistence/form-limits`, which the API enforces too.
 *
 * These forms save through the offline queue, so the server answers later:
 * a 409 comes back through the queue's conflict state ("Updated on another
 * device"). The online-only declaration maps its refusal with
 * `applyServerErrors`.
 */

// ── 1 Who (C11f) ─────────────────────────────────────────────────────────────

export interface WhoValues {
  first: string;
  last: string;
  contact: string;
  goal: string;
  notes: string;
}

export const EMPTY_WHO: WhoValues = {
  first: "",
  last: "",
  contact: "",
  goal: "",
  notes: "",
};

export const NAME_MAX = CLIENT_PROFILE_LIMITS.displayNameMax;
export const CONTACT_MESSAGE = "Enter an email address or a mobile number.";
export const NAME_MESSAGE = `Keep the name to ${NAME_MAX} characters.`;
const GOAL_MESSAGE = "Keep the goal under 200 characters.";
const NOTES_MESSAGE = "Keep the notes under 4,000 characters.";

export const whoSchema = Type.Object({
  first: Type.String({ minLength: 1, errorMessage: "Add a first name." }),
  last: Type.String(),
  contact: Type.Union(
    [
      Type.String({ maxLength: 0 }),
      Type.String({
        pattern: EMAIL_PATTERN,
        maxLength: CLIENT_PROFILE_LIMITS.contactEmailMax,
      }),
      Type.String({
        pattern: PHONE_PATTERN,
        maxLength: CLIENT_PROFILE_LIMITS.contactPhoneMax,
      }),
    ],
    { errorMessage: CONTACT_MESSAGE },
  ),
  goal: Type.String({
    maxLength: CLIENT_PROFILE_LIMITS.goalMax,
    errorMessage: GOAL_MESSAGE,
  }),
  notes: Type.String({
    maxLength: CLIENT_PROFILE_LIMITS.privateNotesMax,
    errorMessage: NOTES_MESSAGE,
  }),
});

/** The name is checked as the API sees it: first and last joined. */
export function whoNameRule(v: WhoValues): Record<string, string> {
  return joinName(v.first, v.last).length > NAME_MAX
    ? { [v.last ? "last" : "first"]: NAME_MESSAGE }
    : {};
}

export const whoResolver = schemaResolver<WhoValues>(whoSchema, {
  prepare: trimmed,
  refine: whoNameRule,
});

export const WHO_SERVER_FIELDS: ServerFieldMap<WhoValues> = {
  displayName: { field: "first", message: NAME_MESSAGE },
  contactEmail: { field: "contact", message: CONTACT_MESSAGE },
  contactPhone: { field: "contact", message: CONTACT_MESSAGE },
  goal: { field: "goal", message: GOAL_MESSAGE },
  privateNotes: { field: "notes", message: NOTES_MESSAGE },
};

export function whoValuesFrom(p: ClientProfile): WhoValues {
  const { first, last } = splitName(p.displayName);
  return {
    first,
    last,
    contact: contactOf(p),
    goal: p.goal ?? "",
    notes: p.privateNotes ?? "",
  };
}

/** Valid values (the resolver passed) → the API's profile fields. */
export function toProfileFields(v: WhoValues): ProfileFields {
  const contact = parseContact(v.contact);
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    displayName: joinName(v.first, v.last),
    contactEmail: contact.kind === "email" ? contact.value : null,
    contactPhone: contact.kind === "phone" ? contact.value : null,
    goal: blank(v.goal),
    privateNotes: blank(v.notes),
  };
}

/** Only what changed, so an edit never overwrites a field it didn't touch. */
export function changedProfileFields(
  before: ClientProfile,
  after: ProfileFields,
): Partial<ProfileFields> {
  const out: Partial<ProfileFields> = {};
  for (const key of [
    "displayName",
    "contactEmail",
    "contactPhone",
    "goal",
    "privateNotes",
  ] as const) {
    if ((before[key] ?? null) !== (after[key] ?? null)) {
      out[key] = after[key] as never;
    }
  }
  return out;
}

// ── 2 Set up: one section page (C11l–r) ──────────────────────────────────────

export interface SetupFormValues {
  section: SetupSection;
  items: SetupItem[];
}

export const TARGETS_MESSAGE =
  "Enter calories and all three macros, or choose who sets them.";
export const WELCOME_MESSAGE = "Keep the message under 1,000 characters.";
const TOO_MANY = "That's more than this section can hold.";

const amount = (maximum: number) =>
  Type.Number({ minimum: 0, maximum, errorMessage: TARGETS_MESSAGE });

const item = (config: TObject = Type.Object({})) =>
  Type.Object({
    refId: Type.Union([Type.String(), Type.Null()]),
    sortOrder: Type.Integer({ minimum: 0 }),
    config,
  });

/** The API's per-section caps (`setupSections.ts` handlers). */
const picker = (maxItems: number) =>
  Type.Object({
    section: Type.String(),
    items: Type.Array(item(), { maxItems, errorMessage: TOO_MANY }),
  });

export const SETUP_SCHEMAS: Record<SetupSection, TObject> = {
  starter_form: picker(20),
  repeating_form: Type.Object({
    section: Type.String(),
    items: Type.Array(
      item(
        Type.Object({
          override: Type.Optional(Type.Partial(ruleFieldsSchema)),
        }),
      ),
      { maxItems: 20, errorMessage: TOO_MANY },
    ),
  }),
  programme: picker(50),
  meal_plan: picker(10),
  resource: picker(20),
  nutrition_target: Type.Object({
    section: Type.String(),
    items: Type.Array(
      item(
        Type.Object({
          dailyKcal: amount(CLIENT_SETUP_LIMITS.maxKcal),
          proteinG: amount(CLIENT_SETUP_LIMITS.maxMacroG),
          carbsG: amount(CLIENT_SETUP_LIMITS.maxMacroG),
          fatG: amount(CLIENT_SETUP_LIMITS.maxMacroG),
        }),
      ),
      { maxItems: 1 },
    ),
  }),
  welcome_message: Type.Object({
    section: Type.String(),
    items: Type.Array(
      item(
        Type.Object({
          text: Type.String({
            maxLength: CLIENT_SETUP_LIMITS.welcomeMessageMax,
            errorMessage: WELCOME_MESSAGE,
          }),
        }),
      ),
      { maxItems: 1 },
    ),
  }),
};

/**
 * The server trims the welcome text before it checks the length (and an
 * empty message is no message), and treats a null check-in override as none.
 */
export function prepareSetup(values: SetupFormValues): SetupFormValues {
  if (values.section === "repeating_form") {
    return {
      ...values,
      items: values.items.map((i) => {
        if (i.config.override !== null) return i;
        const { override: _none, ...config } = i.config;
        return { ...i, config };
      }),
    };
  }
  if (values.section !== "welcome_message") return values;
  return {
    ...values,
    items: values.items
      .map((i) => ({
        ...i,
        config: { ...i.config, text: welcomeText(i).trim() },
      }))
      .filter((i) => i.config.text !== ""),
  };
}

const setupResolvers = Object.fromEntries(
  (Object.keys(SETUP_SCHEMAS) as SetupSection[]).map((s) => [
    s,
    schemaResolver<SetupFormValues>(SETUP_SCHEMAS[s], {
      prepare: prepareSetup,
    }),
  ]),
) as Record<SetupSection, Resolver<SetupFormValues>>;

/** One resolver for the page: it checks the section the form is showing. */
export const setupResolver: Resolver<SetupFormValues> = (values, ctx, opts) =>
  setupResolvers[values.section](values, ctx, opts);

// ── C3.9 settings ────────────────────────────────────────────────────────────

export interface SettingsFormValues {
  trackTraining: boolean;
  trackCalories: boolean;
  sessionsPerWeek: number | null;
  alertMode: AlertMode;
  features: Record<FeatureKey, boolean>;
}

export const SESSIONS_MESSAGE = "Choose 1 to 14 sessions a week.";

export const settingsSchema = Type.Object({
  trackTraining: Type.Boolean(),
  trackCalories: Type.Boolean(),
  sessionsPerWeek: Type.Union(
    [
      Type.Integer({
        minimum: CLIENT_SETTINGS_LIMITS.sessionsPerWeekMin,
        maximum: CLIENT_SETTINGS_LIMITS.sessionsPerWeekMax,
      }),
      Type.Null(),
    ],
    { errorMessage: SESSIONS_MESSAGE },
  ),
  alertMode: Type.Union([
    Type.Literal("default"),
    Type.Literal("mute"),
    Type.Literal("everything"),
  ]),
  features: Type.Record(Type.String(), Type.Boolean()),
});

export const settingsResolver =
  schemaResolver<SettingsFormValues>(settingsSchema);

export function settingsValues(s: ClientSettings): SettingsFormValues {
  return {
    trackTraining: s.trackTraining,
    trackCalories: s.trackCalories,
    sessionsPerWeek: s.sessionsPerWeek,
    alertMode: s.alertMode,
    features: s.features,
  };
}

// ── The coach declaration (D6b) ──────────────────────────────────────────────

export interface DeclarationValues {
  agreed: boolean;
}

export const DECLARATION_TICK_MESSAGE = "Tick the box to confirm.";

export const declarationSchema = Type.Object({
  agreed: Type.Literal(true, { errorMessage: DECLARATION_TICK_MESSAGE }),
});

export const declarationResolver =
  schemaResolver<DeclarationValues>(declarationSchema);

export const DECLARATION_SERVER_FIELDS: ServerFieldMap<DeclarationValues> = {
  statementVersion: {
    field: "agreed",
    message: "The declaration has changed. Close this and try again.",
  },
};
