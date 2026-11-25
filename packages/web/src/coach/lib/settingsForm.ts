import { Type } from "@sinclair/typebox";
import { schemaResolver, type ServerFieldMap } from "@/lib/form";
import type { AlertMode, ClientSettings, FeatureKey } from "../api/types";

/**
 * C3.9 client settings as a react-hook-form (PER-147). Each switch saves on
 * its own, so the form checks the whole set after each change and only a
 * valid change is sent. Limits are the API's settings route: 1–14 sessions a
 * week (or none while training isn't tracked) and the three alert modes.
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
    [Type.Integer({ minimum: 1, maximum: 14 }), Type.Null()],
    { errorMessage: SESSIONS_MESSAGE },
  ),
  alertMode: Type.Union([
    Type.Literal("default"),
    Type.Literal("mute"),
    Type.Literal("everything"),
  ]),
  features: Type.Record(Type.String(), Type.Boolean()),
});

export const settingsResolver = schemaResolver<SettingsFormValues>(
  settingsSchema,
  {
    refine: (v: SettingsFormValues) =>
      v.trackTraining && v.sessionsPerWeek === null
        ? { sessionsPerWeek: SESSIONS_MESSAGE }
        : {},
  },
);

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
