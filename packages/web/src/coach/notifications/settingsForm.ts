import { Type } from "@sinclair/typebox";
import { schemaResolver } from "@/lib/form";
import type {
  Channel,
  NotificationSettings,
  NotificationSettingsInput,
} from "./types";

/**
 * C6 notification settings as a react-hook-form (PER-131, hard rule: forms
 * use react-hook-form with a schema resolver). Each control saves on its own,
 * so the container checks the whole form after a change and only sends a
 * valid one. The rules are the API's (`checkSettings`): a channel is one of
 * four, times are HH:MM, and quiet hours that are on need two different
 * times. The server keeps the final say.
 */

export interface NotificationSettingsValues {
  channels: Record<string, Channel>;
  quietEnabled: boolean;
  quietFrom: string;
  quietUntil: string;
}

export const TIME_MESSAGE = "Use a time like 21:00.";
export const NEED_BOTH_MESSAGE = "Choose when quiet hours start and end.";
export const SAME_MESSAGE = "Start and end need to be different times.";

/** The canvas's suggested window when quiet hours are first turned on. */
export const DEFAULT_QUIET = { from: "21:00", until: "07:00" } as const;

const time = Type.Union(
  [Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }), Type.Literal("")],
  { errorMessage: TIME_MESSAGE },
);

export const notificationSettingsSchema = Type.Object({
  channels: Type.Record(
    Type.String(),
    Type.Union([
      Type.Literal("push"),
      Type.Literal("email"),
      Type.Literal("both"),
      Type.Literal("off"),
    ]),
  ),
  quietEnabled: Type.Boolean(),
  quietFrom: time,
  quietUntil: time,
});

export function quietRules(
  v: NotificationSettingsValues,
): Partial<Record<string, string>> {
  if (!v.quietEnabled) return {};
  if (!v.quietFrom) return { quietFrom: NEED_BOTH_MESSAGE };
  if (!v.quietUntil) return { quietUntil: NEED_BOTH_MESSAGE };
  if (v.quietFrom === v.quietUntil) return { quietUntil: SAME_MESSAGE };
  return {};
}

export const notificationSettingsResolver =
  schemaResolver<NotificationSettingsValues>(notificationSettingsSchema, {
    refine: quietRules as (prepared: never) => Partial<Record<string, string>>,
  });

export function settingsToValues(
  s: NotificationSettings,
): NotificationSettingsValues {
  return {
    channels: { ...s.channels },
    quietEnabled: s.quietHours.enabled,
    quietFrom: s.quietHours.from ?? "",
    quietUntil: s.quietHours.until ?? "",
  };
}

/** The PUT body for a quiet-hours change. */
export function quietInput(
  v: NotificationSettingsValues,
): NotificationSettingsInput {
  return {
    quietHours: {
      enabled: v.quietEnabled,
      from: v.quietFrom || null,
      until: v.quietUntil || null,
    },
  };
}

/**
 * The route's 400 `invalid_settings` says which time is wrong in words
 * ("quiet hours need from and until", "… must differ", "… must be HH:MM").
 * Returns the field and our copy for it, or null for any other refusal.
 */
export function quietServerError(
  e: unknown,
): { field: "quietFrom" | "quietUntil"; message: string } | null {
  if (!e || typeof e !== "object") return null;
  const { status, body } = e as { status?: unknown; body?: unknown };
  if (status !== 400 || !body || typeof body !== "object") return null;
  const b = body as { code?: unknown; message?: unknown };
  if (b.code !== "invalid_settings" || typeof b.message !== "string") {
    return null;
  }
  if (!b.message.startsWith("quiet hours")) return null;
  if (b.message.includes("differ")) {
    return { field: "quietUntil", message: SAME_MESSAGE };
  }
  if (b.message.includes("HH:MM")) {
    return { field: "quietFrom", message: TIME_MESSAGE };
  }
  return { field: "quietFrom", message: NEED_BOTH_MESSAGE };
}
