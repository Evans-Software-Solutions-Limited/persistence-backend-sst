import { CLIENT_SETTINGS_LIMITS } from "@persistence/form-limits";
import type { ClientSettings, SettingsPatch } from "../api/types";

/** C3.9 settings changes, kept pure for the container's optimistic update. */

export const DEFAULT_SESSIONS_PER_WEEK = 3;

export function clampSessions(n: number): number {
  const { sessionsPerWeekMin: min, sessionsPerWeekMax: max } =
    CLIENT_SETTINGS_LIMITS;
  return Math.min(max, Math.max(min, Math.round(n)));
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

/** True when none of the settings `patch` changes moved between two reads. */
export function untouchedBy(
  patch: SettingsPatch,
  before: ClientSettings,
  latest: ClientSettings,
): boolean {
  const scalar = (
    ["trackTraining", "trackCalories", "sessionsPerWeek", "alertMode"] as const
  ).every((k) => patch[k] === undefined || before[k] === latest[k]);
  const features = Object.keys(patch.features ?? {}).every(
    (k) =>
      before.features[k as keyof ClientSettings["features"]] ===
      latest.features[k as keyof ClientSettings["features"]],
  );
  return scalar && features;
}
