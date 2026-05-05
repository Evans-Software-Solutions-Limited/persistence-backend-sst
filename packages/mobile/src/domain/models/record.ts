/**
 * Personal record domain model.
 *
 * Shared between the dashboard PR-of-the-week payload and the (future)
 * M4 Progress milestone's record list UI. Shipped as part of M1 solely
 * for `DashboardPayload.prOfTheWeek` — full CRUD lands in M4.
 *
 * Spec: specs/06-progress-goals/design.md § Domain Models · requirements.md STORY-002
 */

/**
 * PR record type. Ordering matters — the backend's PR-of-the-week
 * tie-breaker prefers earlier entries (higher-impact records) over later
 * ones. Kept in the same order as the parent spec:
 *   `1rm` > `3rm` > `5rm` > `10rm` > `max_weight` > `max_reps` >
 *   `best_time` > `longest_distance`.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard backend contract >
 *       Derivations and sources (PR-of-the-week tie-breaking)
 */
export const RECORD_TYPES = [
  "1rm",
  "3rm",
  "5rm",
  "10rm",
  "max_weight",
  "max_reps",
  "best_time",
  "longest_distance",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export type PersonalRecord = {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  achievedAt: string;
  sessionId: string;
  /**
   * M3: id of the winning set inside the session. Null when the PR
   * came from a legacy import or a piecemeal `personal_records` write
   * that wasn't tied to a specific set. Wire-format-aligned with
   * `ApiPersonalRecord.setId`.
   *
   * Spec: specs/milestones/M3-active-session/BACKEND_BRIEF.md § PR-detection
   */
  setId: string | null;
};
