import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  programAssignments,
  programWorkouts,
  workoutAssignments,
  workoutPrograms,
  workouts,
  type ProgramAssignment,
  type WorkoutAssignment,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";
import {
  INDEFINITE_HORIZON_DAYS,
  addDays,
  buildOccurrences,
  currentWeek,
  endDateFor,
} from "../programs/scheduling";
import { LIVE_ASSIGNMENT_STATUSES } from "./programRepository";

export interface AssignProgramInput {
  clientId: string;
  /** YYYY-MM-DD */
  startDate: string;
  showInPlan?: boolean;
  showInLibrary?: boolean;
}

export type AssignProgramResult =
  | { assignment: ProgramAssignment }
  | { error: "not_found" | "already_assigned" | "empty_program" };

export type UnassignResult = "unassigned" | "not_found";

/** Wire shape for the athlete Home "Your programme" card (STORY-005). */
export interface ActiveProgrammeSummary {
  assignmentId: string;
  programId: string;
  name: string;
  /** 1-based calendar week. */
  week: number;
  /** null = indefinite programme ("Ongoing"). */
  totalWeeks: number | null;
  endDate: string | null;
  startDate: string;
}

/**
 * Programme→client assignment lifecycle (specs/19-programs D2/D4).
 *
 * Assigning MATERIALISES `workout_assignments` occurrence rows — that's what
 * feeds the existing adherence / missed / dashboard / type=assigned readers
 * with zero query changes. Finite programmes materialise fully up front;
 * indefinite ones keep a rolling `INDEFINITE_HORIZON_DAYS` window topped up
 * on client reads (`ensureMaterializedForClient`) — no cron.
 */
export class ProgramAssignmentRepository {
  /**
   * Assign a programme the trainer owns to a client. `today` (YYYY-MM-DD)
   * anchors the indefinite horizon. The relationship guard is the HANDLER's
   * job (403 before this is called); ownership is enforced here.
   */
  async assign(
    trainerId: string,
    programId: string,
    input: AssignProgramInput,
    today: string,
  ): Promise<AssignProgramResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const programRows = await tx
        .select({
          id: workoutPrograms.id,
          durationWeeks: workoutPrograms.durationWeeks,
          daysPerWeek: workoutPrograms.daysPerWeek,
        })
        .from(workoutPrograms)
        .where(
          and(
            eq(workoutPrograms.id, programId),
            eq(workoutPrograms.createdBy, trainerId),
          ),
        )
        .limit(1);
      const program = programRows[0];
      if (!program) return { error: "not_found" as const };

      const cycleRows = await tx
        .select({ workoutId: programWorkouts.workoutId })
        .from(programWorkouts)
        .where(eq(programWorkouts.programId, programId))
        .orderBy(asc(programWorkouts.position));
      if (cycleRows.length === 0) return { error: "empty_program" as const };

      // Pre-check the live-uniqueness invariant for a friendly 409; the
      // partial unique index still backstops a concurrent race (23505).
      const existing = await tx
        .select({ id: programAssignments.id })
        .from(programAssignments)
        .where(
          and(
            eq(programAssignments.programId, programId),
            eq(programAssignments.clientId, input.clientId),
            inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
          ),
        )
        .limit(1);
      if (existing[0]) return { error: "already_assigned" as const };

      const showInPlan = input.showInPlan ?? true;
      const showInLibrary = input.showInLibrary ?? true;

      let assignment: ProgramAssignment;
      try {
        const inserted = await tx
          .insert(programAssignments)
          .values({
            programId,
            clientId: input.clientId,
            assignedBy: trainerId,
            startDate: input.startDate,
            endDate: endDateFor(input.startDate, program.durationWeeks),
            status: "assigned",
            showInPlan,
            showInLibrary,
          })
          .returning();
        assignment = inserted[0];
      } catch (e) {
        // Concurrent duplicate slipped past the pre-check — the partial
        // unique index rejected it.
        if ((e as { code?: string })?.code === "23505") {
          return { error: "already_assigned" as const };
        }
        throw e;
      }

      const occurrences = buildOccurrences({
        startDate: input.startDate,
        daysPerWeek: program.daysPerWeek,
        cycle: cycleRows.map((r) => r.workoutId),
        durationWeeks: program.durationWeeks,
        fromIndex: 0,
        horizonDate:
          program.durationWeeks === null
            ? addDays(today, INDEFINITE_HORIZON_DAYS)
            : undefined,
      });

      if (occurrences.length > 0) {
        await tx.insert(workoutAssignments).values(
          occurrences.map((o) => ({
            trainerId,
            clientId: input.clientId,
            workoutId: o.workoutId,
            assignedDate: today,
            dueDate: o.dueDate,
            status: "assigned" as const,
            programAssignmentId: assignment.id,
            occurrenceIndex: o.occurrenceIndex,
            showInPlan,
            showInLibrary,
          })),
        );
      }

      return { assignment };
    });
  }

  /**
   * Unassign: mark the assignment `skipped` and prune FUTURE untouched
   * occurrences. Completed/past-due history stays so adherence remains
   * honest (requirements AC 3.4).
   */
  async unassign(
    trainerId: string,
    programId: string,
    assignmentId: string,
    today: string,
  ): Promise<UnassignResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      // Ownership + linkage folded into the UPDATE WHERE: the assignment
      // must belong to this programme, the programme to this trainer, and
      // still be live.
      const updated = await tx
        .update(programAssignments)
        .set({ status: "skipped", updatedAt: new Date() })
        .where(
          and(
            eq(programAssignments.id, assignmentId),
            eq(programAssignments.programId, programId),
            eq(programAssignments.assignedBy, trainerId),
            inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
          ),
        )
        .returning();
      if (updated.length === 0) return "not_found";

      await tx
        .delete(workoutAssignments)
        .where(
          and(
            eq(workoutAssignments.programAssignmentId, assignmentId),
            eq(workoutAssignments.status, "assigned"),
            gt(workoutAssignments.dueDate, today),
          ),
        );

      return "unassigned";
    });
  }

  /**
   * Rolling top-up for the client's live INDEFINITE assignments — called
   * from the client read paths (dashboard, type=assigned). Idempotent under
   * concurrency via ON CONFLICT DO NOTHING against the partial unique
   * occurrence index. Reads the CURRENT cycle, which is how "edits apply to
   * future weeks" falls out (requirements AC 1.4).
   */
  async ensureMaterializedForClient(
    clientId: string,
    today: string,
  ): Promise<void> {
    const db = getDb();
    const horizon = addDays(today, INDEFINITE_HORIZON_DAYS);

    const live = await db
      .select({
        id: programAssignments.id,
        programId: programAssignments.programId,
        assignedBy: programAssignments.assignedBy,
        startDate: programAssignments.startDate,
        showInPlan: programAssignments.showInPlan,
        showInLibrary: programAssignments.showInLibrary,
        daysPerWeek: workoutPrograms.daysPerWeek,
        maxIndex: sql<
          number | null
        >`(select max(${workoutAssignments.occurrenceIndex}) from ${workoutAssignments} where ${workoutAssignments.programAssignmentId} = ${programAssignments.id})`,
      })
      .from(programAssignments)
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .where(
        and(
          eq(programAssignments.clientId, clientId),
          inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
          sql`${workoutPrograms.durationWeeks} is null`,
        ),
      );

    for (const a of live) {
      const cycleRows = await db
        .select({ workoutId: programWorkouts.workoutId })
        .from(programWorkouts)
        .where(eq(programWorkouts.programId, a.programId))
        .orderBy(asc(programWorkouts.position));
      if (cycleRows.length === 0) continue;

      const occurrences = buildOccurrences({
        startDate: a.startDate,
        daysPerWeek: a.daysPerWeek,
        cycle: cycleRows.map((r) => r.workoutId),
        durationWeeks: null,
        fromIndex: (a.maxIndex ?? -1) + 1,
        horizonDate: horizon,
      });
      if (occurrences.length === 0) continue;

      await db
        .insert(workoutAssignments)
        .values(
          occurrences.map((o) => ({
            trainerId: a.assignedBy,
            clientId,
            workoutId: o.workoutId,
            assignedDate: today,
            dueDate: o.dueDate,
            status: "assigned" as const,
            programAssignmentId: a.id,
            occurrenceIndex: o.occurrenceIndex,
            showInPlan: a.showInPlan,
            showInLibrary: a.showInLibrary,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /**
   * The client's live programme for the Home card. When jointly coached
   * with two live programmes (rare), the most recently started wins.
   * Respects `show_in_plan` — an assignment the coach hid from the plan
   * doesn't surface a card.
   */
  async getActiveProgrammeForClient(
    clientId: string,
    today: string,
  ): Promise<ActiveProgrammeSummary | null> {
    const db = getDb();
    const rows = await db
      .select({
        assignmentId: programAssignments.id,
        programId: programAssignments.programId,
        name: workoutPrograms.name,
        durationWeeks: workoutPrograms.durationWeeks,
        startDate: programAssignments.startDate,
        endDate: programAssignments.endDate,
      })
      .from(programAssignments)
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .where(
        and(
          eq(programAssignments.clientId, clientId),
          inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
          eq(programAssignments.showInPlan, true),
        ),
      )
      .orderBy(sql`${programAssignments.startDate} desc`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    return {
      assignmentId: row.assignmentId,
      programId: row.programId,
      name: row.name,
      week: currentWeek(row.startDate, today, row.durationWeeks),
      totalWeeks: row.durationWeeks,
      endDate: row.endDate,
      startDate: row.startDate,
    };
  }

  /**
   * Link a just-recorded completed session to the client's earliest OPEN
   * occurrence of that workout, then advance the parent programme
   * assignment (assigned → started on first completion; → completed when a
   * FINITE programme's last occurrence closes).
   *
   * Runs inside the /sessions/record transaction via the handler's DI
   * callback (same pattern as PR detection). Retry-idempotent by
   * construction: the `status IN (live)` guard makes a replay that finds no
   * open occurrence a no-op, and an already-completed occurrence can never
   * be re-linked. Zero matches (plain unassigned session) is a no-op.
   */
  async linkCompletedSession(
    clientId: string,
    workoutId: string,
    sessionId: string,
    executor: DbOrTx = getDb(),
  ): Promise<void> {
    const candidates = await executor
      .select({
        id: workoutAssignments.id,
        programAssignmentId: workoutAssignments.programAssignmentId,
      })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.clientId, clientId),
          eq(workoutAssignments.workoutId, workoutId),
          inArray(workoutAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
        ),
      )
      // Earliest due first; ad-hoc rows without a due date go last.
      .orderBy(sql`${workoutAssignments.dueDate} asc nulls last`)
      .limit(1);
    const target = candidates[0];
    if (!target) return;

    const updated = await executor
      .update(workoutAssignments)
      .set({ status: "completed", completedSessionId: sessionId })
      .where(
        and(
          eq(workoutAssignments.id, target.id),
          // Re-guard: a concurrent completion of the same occurrence loses.
          inArray(workoutAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
        ),
      )
      .returning({ id: workoutAssignments.id });
    if (updated.length === 0 || !target.programAssignmentId) return;

    // Parent transition. Remaining open occurrences AFTER this update.
    const parentRows = await executor
      .select({
        id: programAssignments.id,
        status: programAssignments.status,
        durationWeeks: workoutPrograms.durationWeeks,
      })
      .from(programAssignments)
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .where(eq(programAssignments.id, target.programAssignmentId))
      .limit(1);
    const parent = parentRows[0];
    if (!parent) return;

    const remainingRows = await executor
      .select({ remaining: sql<number>`count(*)::int` })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.programAssignmentId, parent.id),
          inArray(workoutAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
        ),
      );
    const remaining = remainingRows[0]?.remaining ?? 0;

    // Finite programme fully worked through → completed. Indefinite
    // programmes never auto-complete (remaining hits 0 between top-ups).
    const nextStatus =
      parent.durationWeeks !== null && remaining === 0
        ? ("completed" as const)
        : parent.status === "assigned"
          ? ("started" as const)
          : null;
    if (nextStatus === null) return;

    await executor
      .update(programAssignments)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(
        and(
          eq(programAssignments.id, parent.id),
          inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
        ),
      );
  }

  /**
   * Ad-hoc single-workout assignment (STORY-006) — a `workout_assignments`
   * row with NO programme linkage. Same readability rule as programme
   * structure: the workout must be the trainer's own or public.
   */
  async createAdHoc(
    trainerId: string,
    clientId: string,
    input: {
      workoutId: string;
      dueDate?: string | null;
      showInPlan?: boolean;
      showInLibrary?: boolean;
      trainerNotes?: string | null;
    },
    today: string,
  ): Promise<{ assignment: WorkoutAssignment } | { error: "invalid_workout" }> {
    const db = getDb();
    const readable = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(
        and(
          eq(workouts.id, input.workoutId),
          or(
            eq(workouts.createdBy, trainerId),
            eq(workouts.visibility, "public"),
          ),
        ),
      )
      .limit(1);
    if (!readable[0]) return { error: "invalid_workout" as const };

    const [assignment] = await db
      .insert(workoutAssignments)
      .values({
        trainerId,
        clientId,
        workoutId: input.workoutId,
        assignedDate: today,
        dueDate: input.dueDate ?? null,
        status: "assigned",
        trainerNotes: input.trainerNotes ?? null,
        showInPlan: input.showInPlan ?? true,
        showInLibrary: input.showInLibrary ?? true,
      })
      .returning();
    return { assignment };
  }

  /**
   * Remove an ad-hoc assignment. Only untouched (`assigned`) rows without a
   * programme linkage are deletable — completed history stays, and
   * programme occurrences are managed via unassign, not this path.
   */
  async deleteAdHoc(
    trainerId: string,
    clientId: string,
    assignmentId: string,
  ): Promise<"deleted" | "not_found" | "not_deletable"> {
    const db = getDb();
    const deleted = await db
      .delete(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.id, assignmentId),
          eq(workoutAssignments.trainerId, trainerId),
          eq(workoutAssignments.clientId, clientId),
          eq(workoutAssignments.status, "assigned"),
          sql`${workoutAssignments.programAssignmentId} is null`,
        ),
      )
      .returning({ id: workoutAssignments.id });
    if (deleted.length > 0) return "deleted";

    // Distinguish 404 from 409: does the row exist for this trainer+client
    // at all (just not deletable)?
    const exists = await db
      .select({ id: workoutAssignments.id })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.id, assignmentId),
          eq(workoutAssignments.trainerId, trainerId),
          eq(workoutAssignments.clientId, clientId),
        ),
      )
      .limit(1);
    return exists[0] ? "not_deletable" : "not_found";
  }
}
