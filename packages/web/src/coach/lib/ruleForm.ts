import { FORM_SCHEDULE_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaResolver, type ServerFieldMap } from "@/lib/form";
import type { EffectiveRule } from "./schedule";

/**
 * Send rules as react-hook-form forms (PER-147): the send dialog (C10c), one
 * client's rule (C10j) and a set-up check-in's override (C11b). Limits are
 * the API's `checkRule` (scheduleRepository.ts): weekday 1–7, HH:MM times,
 * due 1–2,160 hours after the send, up to 5 reminders of 1–720 hours.
 */

export const MAX_DUE_HOURS = FORM_SCHEDULE_LIMITS.maxDueHours;
export const MAX_REMINDER_HOURS = FORM_SCHEDULE_LIMITS.maxReminderHours;
export const MAX_RULE_REMINDERS = FORM_SCHEDULE_LIMITS.maxReminders;
export const MAX_SELECTED_CLIENTS = FORM_SCHEDULE_LIMITS.maxSelectedClients;
const TIME = "^([01]\\d|2[0-3]):([0-5]\\d)(:([0-5]\\d))?$";

export const TIME_MESSAGE = "Choose a time to send it.";
export const DAY_MESSAGE = "Choose a day to send it.";
export const DUE_MESSAGE = "Choose when it's due.";
export const REMINDER_MESSAGE = "Check the reminders.";
export const WHO_MESSAGE = "Add at least one client.";

export const ruleFields = {
  weekday: Type.Union(
    [
      Type.Integer({
        minimum: FORM_SCHEDULE_LIMITS.weekdayMin,
        maximum: FORM_SCHEDULE_LIMITS.weekdayMax,
      }),
      Type.Null(),
    ],
    {
      errorMessage: DAY_MESSAGE,
    },
  ),
  timeLocal: Type.Union([Type.String({ pattern: TIME }), Type.Null()], {
    errorMessage: TIME_MESSAGE,
  }),
  dueAfterHours: Type.Union(
    [Type.Integer({ minimum: 1, maximum: MAX_DUE_HOURS }), Type.Null()],
    { errorMessage: DUE_MESSAGE },
  ),
  reminders: Type.Array(
    Type.Object({
      afterHours: Type.Integer({ minimum: 1, maximum: MAX_REMINDER_HOURS }),
    }),
    { maxItems: MAX_RULE_REMINDERS, errorMessage: REMINDER_MESSAGE },
  ),
};

export const ruleSchema = Type.Object({
  trigger: Type.String({ minLength: 1 }),
  ...ruleFields,
});

/** What a weekly or daily rule needs that the schema can't say alone. */
export function ruleGaps(
  rule: Pick<EffectiveRule, "trigger" | "weekday" | "timeLocal">,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  if (rule.trigger === "weekly" && !rule.weekday) {
    out[`${prefix}weekday`] = DAY_MESSAGE;
  }
  if (
    (rule.trigger === "weekly" || rule.trigger === "daily") &&
    !rule.timeLocal
  ) {
    out[`${prefix}timeLocal`] = TIME_MESSAGE;
  }
  return out;
}

/** One client's rule (C10j): just the rule. */
export const clientRuleResolver = schemaResolver<EffectiveRule>(ruleSchema, {
  refine: (rule: EffectiveRule) => ruleGaps(rule),
});

/** The send dialog (C10c): who gets it, and the rule. */
export interface SendFormValues {
  all: boolean;
  clientIds: string[];
  rule: EffectiveRule;
}

export const sendSchema = Type.Object({
  all: Type.Boolean(),
  clientIds: Type.Array(Type.String(), { maxItems: MAX_SELECTED_CLIENTS }),
  rule: ruleSchema,
});

export const sendResolver = schemaResolver<SendFormValues>(sendSchema, {
  refine: (v: SendFormValues) => ({
    ...(!v.all && v.rule.trigger !== "on_join" && v.clientIds.length === 0
      ? { clientIds: WHO_MESSAGE }
      : {}),
    ...ruleGaps(v.rule, "rule."),
  }),
});

/** A rule override inside a set-up check-in (every field optional). */
export const overrideSchema = Type.Object({
  trigger: Type.Optional(
    Type.Union([
      Type.Literal("once"),
      Type.Literal("weekly"),
      Type.Literal("daily"),
      Type.Null(),
    ]),
  ),
  weekday: Type.Optional(ruleFields.weekday),
  timeLocal: Type.Optional(ruleFields.timeLocal),
  dueAfterHours: Type.Optional(ruleFields.dueAfterHours),
  reminders: Type.Optional(ruleFields.reminders),
});

/** Where a 422 on a send rule lands. */
export const RULE_SERVER_FIELDS: ServerFieldMap<EffectiveRule> = {
  weekday: { field: "weekday", message: DAY_MESSAGE },
  timeLocal: { field: "timeLocal", message: TIME_MESSAGE },
  dueAfterHours: { field: "dueAfterHours", message: DUE_MESSAGE },
  reminders: { field: "reminders", message: REMINDER_MESSAGE },
  afterHours: { field: "reminders", message: REMINDER_MESSAGE },
};

export const SEND_SERVER_FIELDS: ServerFieldMap<SendFormValues> = {
  clientIds: { field: "clientIds", message: WHO_MESSAGE },
  weekday: { field: "rule.weekday", message: DAY_MESSAGE },
  timeLocal: { field: "rule.timeLocal", message: TIME_MESSAGE },
  dueAfterHours: { field: "rule.dueAfterHours", message: DUE_MESSAGE },
  reminders: { field: "rule.reminders", message: REMINDER_MESSAGE },
  afterHours: { field: "rule.reminders", message: REMINDER_MESSAGE },
};
