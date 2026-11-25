import { CLIENT_SETTINGS_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaResolver, type ServerFieldMap } from "@/lib/form";
import type { AlertMode, ClientSettings, FeatureKey } from "../api/types";

/**
 * C3.9 client settings as a react-hook-form (PER-147). Each switch saves on
 * its own, so the form checks the whole set after each change and only a
 * valid change is sent. Limits are the API's settings route: 1–14 sessions a
 * week, or none, and the three alert modes.
 */

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

/**
 * No cross-field rule: the API accepts training on with no target yet (an
 * accepted set-up with a programme writes exactly that), so such a client's
 * other switches must still save. Turning training on gives it a target of
 * three (`trainingPatch`).
 */
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

export const SETTINGS_SERVER_FIELDS: ServerFieldMap<SettingsFormValues> = {
  sessionsPerWeek: { field: "sessionsPerWeek", message: SESSIONS_MESSAGE },
};
