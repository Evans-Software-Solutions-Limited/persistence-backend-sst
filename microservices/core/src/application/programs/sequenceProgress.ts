import { and, inArray, sql } from "drizzle-orm";
import { workoutAssignments } from "@persistence/db";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
import {
  weekOfProgramme,
  type ScheduleMode,
  type WeekOfProgramme,
} from "./scheduling";

/**
 * Next and progress for `sequence` programme assignments (PER-112, design G
 * part 2). Shared by every read that returns `nextAssignmentId` /
 * `weekOfProgramme`, so the Home card, the coach's views, the athlete's
 * programme detail and the AI weekly summary (PER-115) can't disagree.
 */

/** Open = not yet completed (or skipped). Mirrors LIVE_ASSIGNMENT_STATUSES. */
const OPEN_STATUSES = ["assigned", "started"] as const;

export interface SequenceProgress {
  /** workout_assignments.id of Next: the lowest open sequence index. */
  nextAssignmentId: string | null;
  nextSequenceIndex: number | null;
  /** Workouts created so far for the assignment. */
  sequenceCount: number;
}

const NONE: SequenceProgress = {
  nextAssignmentId: null,
  nextSequenceIndex: null,
  sequenceCount: 0,
};

/** One grouped read for any number of programme assignments. */
export async function loadSequenceProgress(
  db: DbOrTx,
  programAssignmentIds: string[],
): Promise<Map<string, SequenceProgress>> {
  const ids = [...new Set(programAssignmentIds)];
  const out = new Map<string, SequenceProgress>();
  if (ids.length === 0) return out;
  const open = sql.join(
    OPEN_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const rows = await db
    .select({
      programAssignmentId: workoutAssignments.programAssignmentId,
      sequenceCount: sql<number>`count(*)::int`,
      nextSequenceIndex: sql<
        number | null
      >`min(${workoutAssignments.sequenceIndex}) filter (where ${workoutAssignments.status} in (${open}))`,
      // The id that goes with the lowest open index (array_agg ordered, first).
      nextAssignmentId: sql<
        string | null
      >`(array_agg(${workoutAssignments.id}::text order by ${workoutAssignments.sequenceIndex}) filter (where ${workoutAssignments.status} in (${open})))[1]`,
    })
    .from(workoutAssignments)
    .where(
      and(
        inArray(workoutAssignments.programAssignmentId, ids),
        sql`${workoutAssignments.sequenceIndex} is not null`,
      ),
    )
    .groupBy(workoutAssignments.programAssignmentId);
  for (const r of rows) {
    // The WHERE clause makes programAssignmentId non-null on every row.
    out.set(r.programAssignmentId as string, {
      nextAssignmentId: r.nextAssignmentId,
      nextSequenceIndex:
        r.nextSequenceIndex === null ? null : Number(r.nextSequenceIndex),
      sequenceCount: Number(r.sequenceCount),
    });
  }
  return out;
}

/** The additive read fields every programme read returns (design G). */
export interface ProgrammeOrderFields {
  scheduleMode: ScheduleMode;
  /** Next's workout_assignments.id; null for dated programmes. */
  nextAssignmentId: string | null;
  weekOfProgramme: WeekOfProgramme;
}

/** `scheduleMode` from a row; anything but 'sequence' (or absent) is dated. */
export function toScheduleMode(value: unknown): ScheduleMode {
  return value === "sequence" ? "sequence" : "dated";
}

/**
 * Build the read fields for one assignment. `progress` comes from
 * `loadSequenceProgress` and is only needed for sequence assignments.
 */
export function programmeOrderFields(params: {
  scheduleMode: unknown;
  startDate: string;
  today: string;
  durationWeeks: number | null;
  daysPerWeek: number;
  progress: SequenceProgress | undefined;
}): ProgrammeOrderFields {
  const scheduleMode = toScheduleMode(params.scheduleMode);
  const progress =
    scheduleMode === "sequence" ? (params.progress ?? NONE) : NONE;
  return {
    scheduleMode,
    nextAssignmentId: progress.nextAssignmentId,
    weekOfProgramme: weekOfProgramme({
      scheduleMode,
      startDate: params.startDate,
      today: params.today,
      durationWeeks: params.durationWeeks,
      daysPerWeek: params.daysPerWeek,
      nextSequenceIndex: progress.nextSequenceIndex,
      sequenceCount: progress.sequenceCount,
    }),
  };
}

/**
 * Read fields for many assignments with ONE extra query, and none at all when
 * no assignment is in sequence mode (dated reads keep today's query count).
 */
export async function programmeOrderFieldsFor<
  T extends {
    id: string;
    scheduleMode: unknown;
    startDate: string;
    durationWeeks: number | null;
    daysPerWeek: number;
  },
>(
  db: DbOrTx,
  rows: T[],
  today: string,
): Promise<Map<string, ProgrammeOrderFields>> {
  const sequenceIds = rows
    .filter((r) => toScheduleMode(r.scheduleMode) === "sequence")
    .map((r) => r.id);
  const progress =
    sequenceIds.length > 0
      ? await loadSequenceProgress(db, sequenceIds)
      : new Map<string, SequenceProgress>();
  return new Map(
    rows.map((r) => [
      r.id,
      programmeOrderFields({
        scheduleMode: r.scheduleMode,
        startDate: r.startDate,
        today,
        durationWeeks: r.durationWeeks,
        daysPerWeek: r.daysPerWeek,
        progress: progress.get(r.id),
      }),
    ]),
  );
}

/**
 * SQL condition for "Today's training" style lists (Home, dashboard): keep
 * every row that isn't a sequence workout, and only Next of each sequence
 * programme. Without it a sequence programme (every workout undated) would
 * fill those lists, which show undated rows as "do any time", with its whole
 * plan, on 1.2.0 phones too.
 *
 * Table names are written out so the outer columns stay qualified inside the
 * correlated subquery (Drizzle leaves them bare in a single-table select).
 */
export const isNextOrNotSequenced = sql`("workout_assignments"."sequence_index" is null or "workout_assignments"."sequence_index" = (
  select min(wa_next.sequence_index) from workout_assignments wa_next
  where wa_next.program_assignment_id = "workout_assignments"."program_assignment_id"
    and wa_next.status in ('assigned', 'started')
))`;
