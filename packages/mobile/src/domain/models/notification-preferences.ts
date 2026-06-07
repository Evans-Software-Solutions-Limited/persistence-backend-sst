/**
 * Notification preferences domain model — the per-type opt-in map backing
 * the Preferences screen (09.4) and the first-open default write.
 *
 * Spec: specs/09-notifications-social/design.md § Frontend —
 *       NotificationPreferencesPresenter (Revised 2026-06-07)
 *       requirements.md STORY-003
 *
 * Backend contract (PR #81): `POST /notifications/preferences` validates
 * every key against the 9-value `NOTIFICATION_TYPES` enum and 400s on an
 * unknown key, then atomically JSONB-merges the partial. `GET` applies
 * defaults for missing keys (empty column reads as "all enabled") and
 * drops stale keys. So the client preference map is keyed by the 9 known
 * types only — sending a design.md-era key (streak_milestone, etc.) would
 * be rejected. Those types are registered by their producing specs later.
 */

import type { NotificationType } from "./notification";
import { NOTIFICATION_TYPES } from "./notification";

/**
 * Per-type opt-in map. Partial because both the wire payload (a partial
 * merge) and a freshly-defaulted column may omit keys. Read sites should
 * treat a missing key as opted-in (the backend default), via
 * `isTypeEnabled`.
 */
export type NotificationPreferences = Partial<
  Record<NotificationType, boolean>
>;

/**
 * A category grouping for the Preferences screen. Data-driven: registering
 * a new notification type later means adding its value to the relevant
 * `types` array here (and the enum + icon map) — a one-line additive
 * change, per the enum-extension contract.
 *
 * Groupings reconciled to the 9 shipped types (Revised 2026-06-07).
 * design.md's original Streaks/Goals/Trainer/Nutrition groupings were
 * built on the not-yet-shipped taxonomy; these mirror the live producers.
 */
export type NotificationCategory = {
  title: string;
  types: NotificationType[];
};

export const CATEGORIES: readonly NotificationCategory[] = [
  { title: "Workouts", types: ["workout_assigned", "workout_reminder"] },
  { title: "Goals", types: ["goal_milestone"] },
  {
    title: "Trainer & Physio",
    types: [
      "pt_request",
      "pt_accepted",
      "physio_request",
      "physio_accepted",
      "trainer_feedback",
    ],
  },
  { title: "Social", types: ["friend_request"] },
];

/**
 * Default opt-in map. Every known type defaults ON — mirrors the
 * backend's read-path default (an empty `notification_preferences`
 * column reads as "all enabled"). Written on first open of the
 * Preferences screen (STORY-003 AC 3.7) so the stored column matches the
 * UI from the first interaction.
 */
export const DEFAULT_OPT_IN: NotificationPreferences = Object.freeze(
  NOTIFICATION_TYPES.reduce<Record<NotificationType, boolean>>(
    (acc, type) => {
      acc[type] = true;
      return acc;
    },
    {} as Record<NotificationType, boolean>,
  ),
);

/**
 * Resolve whether a type is enabled, applying the backend's
 * default-true semantics for any key absent from the stored map.
 */
export function isTypeEnabled(
  preferences: NotificationPreferences,
  type: NotificationType,
): boolean {
  return preferences[type] ?? true;
}

/**
 * Normalise an arbitrary wire object (the GET / POST response JSONB) into
 * a `NotificationPreferences` keyed only by known types. Unknown / stale
 * keys are dropped (the backend already reconciles, but the client
 * defends too); non-boolean values are ignored. Keeps the local cache
 * honest regardless of server drift.
 */
export function normalizePreferences(
  raw: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  const out: NotificationPreferences = {};
  if (!raw) return out;
  for (const type of NOTIFICATION_TYPES) {
    const value = raw[type];
    if (typeof value === "boolean") {
      out[type] = value;
    }
  }
  return out;
}
