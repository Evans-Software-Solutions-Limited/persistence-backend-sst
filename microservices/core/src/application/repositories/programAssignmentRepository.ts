import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  programAssignments,
  programWorkouts,
  workoutAssignments,
  workoutPrograms,
  type ProgramAssignment,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
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
}
