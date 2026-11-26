import { CLIENT_SETUP_LIMITS } from "@persistence/form-limits";
import { Type, type TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Resolver } from "react-hook-form";
import {
  installFormMessages,
  schemaResolver,
  type ServerFieldMap,
} from "@/lib/form";
import type { SetupItem, SetupSection } from "../api/types";
import { overrideSchema } from "./ruleForm";

/**
 * Add client · 2 Set up (PER-147): one react-hook-form per open section, its
 * rules a TypeBox schema per section. Limits match the API's set-up route
 * (`setupSections.ts`): targets 0–20,000 kcal and 0–2,000 g a macro, a
 * welcome message up to 1,000 characters once trimmed.
 */

export interface SetupFormValues {
  section: SetupSection;
  items: SetupItem[];
}

export const TARGETS_MESSAGE =
  "Enter calories and all three macros, or choose who sets them.";
export const WELCOME_MESSAGE = "Keep the message under 1,000 characters.";

const MAX_KCAL = CLIENT_SETUP_LIMITS.maxKcal;
const MAX_MACRO_G = CLIENT_SETUP_LIMITS.maxMacroG;

const amount = (maximum: number) =>
  Type.Number({ minimum: 0, maximum, errorMessage: TARGETS_MESSAGE });

const item = (config: TObject = Type.Object({})) =>
  Type.Object({
    refId: Type.Union([Type.String(), Type.Null()]),
    sortOrder: Type.Integer({ minimum: 0 }),
    config,
  });

const pickerSchema = Type.Object({
  section: Type.String(),
  items: Type.Array(item()),
});

export const SETUP_SCHEMAS: Record<SetupSection, TObject> = {
  starter_form: pickerSchema,
  repeating_form: Type.Object({
    section: Type.String(),
    items: Type.Array(
      item(Type.Object({ override: Type.Optional(overrideSchema) })),
    ),
  }),
  programme: pickerSchema,
  meal_plan: pickerSchema,
  resource: pickerSchema,
  nutrition_target: Type.Object({
    section: Type.String(),
    items: Type.Array(
      item(
        Type.Object({
          dailyKcal: amount(MAX_KCAL),
          proteinG: amount(MAX_MACRO_G),
          carbsG: amount(MAX_MACRO_G),
          fatG: amount(MAX_MACRO_G),
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
 * The server trims the welcome text before it checks the length, and treats
 * a null check-in override as none.
 */
function prepare(values: SetupFormValues): SetupFormValues {
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
    items: values.items.map((i) => ({
      ...i,
      config: {
        ...i.config,
        text: String((i.config.text as string | undefined) ?? "").trim(),
      },
    })),
  };
}

const resolvers = Object.fromEntries(
  (Object.keys(SETUP_SCHEMAS) as SetupSection[]).map((s) => [
    s,
    schemaResolver<SetupFormValues>(SETUP_SCHEMAS[s], { prepare }),
  ]),
) as Record<SetupSection, Resolver<SetupFormValues>>;

/** One resolver for the step: it checks the section the form is showing. */
export const setupResolver: Resolver<SetupFormValues> = (values, ctx, opts) =>
  resolvers[values.section](values, ctx, opts);

/**
 * The same rules without a form, for the background save when the coach
 * leaves by a link: a draft the form would refuse isn't sent.
 */
export function setupProblem(
  section: SetupSection,
  items: SetupItem[],
): string | null {
  installFormMessages();
  const first = Value.Errors(
    SETUP_SCHEMAS[section],
    prepare({ section, items }),
  ).First();
  return first ? first.message : null;
}

/** Where a 422 on a section save lands: the section's own message. */
export function setupServerFields(
  section: SetupSection,
): ServerFieldMap<SetupFormValues> {
  if (section === "nutrition_target") {
    return { items: { field: "items", message: TARGETS_MESSAGE } };
  }
  if (section === "welcome_message") {
    return { items: { field: "items", message: WELCOME_MESSAGE } };
  }
  return {};
}
