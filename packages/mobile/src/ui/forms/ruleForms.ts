import { FORM_SCHEDULE_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaAccepts, schemaResolver } from "@/shared/form";
import {
  MAX_DUE_HOURS,
  MAX_REMINDERS,
  MAX_REMINDER_HOURS,
  type FormAudience,
  type FormTrigger,
  type RuleFields,
} from "@/domain/models/coachForms";

/**
 * Send rules on react-hook-form (PER-147): the send sheet (C10h) and one
 * client's set-up (C10j). Limits are the API's `checkRule`: weekday 1–7,
 * HH:MM, due 1–2,160 hours, up to 5 reminders of 1–720 hours. Weekly needs
 * a day and a time, daily a time; chosen clients need at least one; "when
 * they join" goes to all clients.
 */

const TIME = "^([01]\\d|2[0-3]):([0-5]\\d)(:([0-5]\\d))?$";

export const ruleFieldsSchema = Type.Object({
  weekday: Type.Union([
    Type.Integer({
      minimum: FORM_SCHEDULE_LIMITS.weekdayMin,
      maximum: FORM_SCHEDULE_LIMITS.weekdayMax,
    }),
    Type.Null(),
  ]),
  timeLocal: Type.Union([Type.String({ pattern: TIME }), Type.Null()]),
  dueAfterHours: Type.Union([
    Type.Integer({ minimum: 1, maximum: MAX_DUE_HOURS }),
    Type.Null(),
  ]),
  reminders: Type.Array(
    Type.Object({
      afterHours: Type.Integer({ minimum: 1, maximum: MAX_REMINDER_HOURS }),
    }),
    { maxItems: MAX_REMINDERS },
  ),
});

export interface ClientRuleValues {
  trigger: FormTrigger;
  rule: RuleFields;
}

export const clientRuleSchema = Type.Object({
  trigger: Type.String(),
  rule: ruleFieldsSchema,
});

/** What a weekly or daily rule needs that the schema can't say alone. */
export function ruleGaps(v: ClientRuleValues): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.trigger === "weekly" && !v.rule.weekday) {
    out["rule.weekday"] = "Choose a day to send it.";
  }
  if ((v.trigger === "weekly" || v.trigger === "daily") && !v.rule.timeLocal) {
    out["rule.timeLocal"] = "Choose a time to send it.";
  }
  return out;
}

export const clientRuleResolver = schemaResolver<ClientRuleValues>(
  clientRuleSchema,
  { refine: ruleGaps },
);

export function clientRuleAccepts(v: ClientRuleValues): boolean {
  return schemaAccepts(clientRuleSchema, v, ruleGaps);
}

export interface SendSheetValues extends ClientRuleValues {
  audience: FormAudience;
  selectedIds: string[];
}

export const sendSheetSchema = Type.Object({
  trigger: Type.String(),
  audience: Type.Union([Type.Literal("all_clients"), Type.Literal("selected")]),
  selectedIds: Type.Array(Type.String(), {
    maxItems: FORM_SCHEDULE_LIMITS.maxSelectedClients,
  }),
  rule: ruleFieldsSchema,
});

export function sendGaps(v: SendSheetValues): Record<string, string> {
  const out = ruleGaps(v);
  if (v.trigger === "on_join" && v.audience !== "all_clients") {
    out.audience = "Forms for when they join go to every new client.";
  }
  if (v.audience === "selected" && v.selectedIds.length === 0) {
    out.selectedIds = "Add at least one client.";
  }
  return out;
}

export const sendSheetResolver = schemaResolver<SendSheetValues>(
  sendSheetSchema,
  { refine: sendGaps },
);

export function sendSheetAccepts(v: SendSheetValues): boolean {
  return schemaAccepts(sendSheetSchema, v, sendGaps);
}
