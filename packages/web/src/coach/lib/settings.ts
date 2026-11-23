import type { ClientSettings, SettingsPatch } from "../api/types";

/** C3.9 settings changes, kept pure for the container's optimistic update. */

export const DEFAULT_SESSIONS_PER_WEEK = 3;

export function clampSessions(n: number): number {
  return Math.min(14, Math.max(1, Math.round(n)));
}

/** Turning training tracking on needs a target; start at three a week. */
export function trainingPatch(
  settings: ClientSettings,
  on: boolean,
): SettingsPatch {
  return on && settings.sessionsPerWeek === null
    ? { trackTraining: true, sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK }
    : { trackTraining: on };
}

export function applyPatch(
  settings: ClientSettings,
  patch: SettingsPatch,
): ClientSettings {
  return {
    ...settings,
    ...(patch.trackTraining !== undefined
      ? { trackTraining: patch.trackTraining }
      : {}),
    ...(patch.trackCalories !== undefined
      ? { trackCalories: patch.trackCalories }
      : {}),
    ...(patch.sessionsPerWeek !== undefined
      ? { sessionsPerWeek: patch.sessionsPerWeek }
      : {}),
    ...(patch.alertMode !== undefined ? { alertMode: patch.alertMode } : {}),
    features: { ...settings.features, ...(patch.features ?? {}) },
  };
}
