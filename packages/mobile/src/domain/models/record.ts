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
  // M3 Phase 3b: highest weight × reps in a single set, per exercise.
  // Added alongside the broadened server-side PR detection in PR #61
  // (`supabase/migrations/20260512090238_m3_record_type_max_volume.sql`).
  // Keep aligned with the Postgres `record_type` enum.
  "max_volume",
  "max_reps",
  "best_time",
  "longest_distance",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

/**
 * Display unit for a PR value, keyed off its record type. The weight types
 * (`*rm`, `max_weight`, `max_volume`) carry a kilogram value; `max_reps` is a
 * count, `best_time` is seconds, `longest_distance` is metres. Mirrors the
 * legacy mapping (persistence-mobile `progressQueries.ts` §"Determine unit")
 * so a 15-rep PR never renders as "15 kg". Imperial conversion is a separate
 * concern not wired at this layer.
 */
export function unitForRecordType(recordType: RecordType): string {
  switch (recordType) {
    case "max_reps":
      return "reps";
    case "best_time":
      return "s";
    case "longest_distance":
      return "m";
    default:
      return "kg"; // 1rm/3rm/5rm/10rm/max_weight/max_volume
  }
}

export type PersonalRecord = {
  id: string;
  userId: string;
  exerciseId: string;
  /**
   * Display label captured at write-time so PRs render correctly even
   * if the underlying exercise is renamed or deleted. Not on the wire
   * (`ApiPersonalRecord` has no name) — the API adapter joins it from
   * the exercise cache, the M3 client predictor reads it from the
   * session row.
   */
  exerciseName: string;
  recordType: RecordType;
  value: number;
  achievedAt: string;
  /**
   * Session that produced the PR. Null when the PR came from a legacy
   * import or backend reconciliation where the source session isn't
   * known to the client. Wire format (`ApiPersonalRecord`) does not
   * carry a sessionId.
   */
  sessionId: string | null;
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
