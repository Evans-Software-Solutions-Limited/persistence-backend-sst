import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  profiles,
  programAssignments,
  programWorkouts,
  workoutPrograms,
  workouts,
} from "@persistence/db";
import { getDb, type Db } from "@persistence/db/client";
import { initialsFromName } from "./trainerRepository";
import { currentWeek } from "../programs/scheduling";

type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Statuses that make a programme assignment LIVE (in-flight). */
export const LIVE_ASSIGNMENT_STATUSES = ["assigned", "started"] as const;

// ─── Wire shapes ──────────────────────────────────────────────────────────────

export interface ProgramSummary {
  id: string;
  name: string;
  description: string | null;
  /** null = indefinite programme (specs/19-programs D1). */
  durationWeeks: number | null;
  daysPerWeek: number;
  workoutCount: number;
  activeClientCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProgramWorkoutEntry {
  /** program_workouts row id. */
  id: string;
  workoutId: string;
  position: number;
  name: string;
  estimatedDurationMinutes: number | null;
}

export interface ProgramAssignmentEntry {
  id: string;
  clientId: string;
  clientName: string;
  clientInitials: string;
  avatarUrl: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  /** 1-based calendar week the client is currently in. */
  currentWeek: number;
}

export interface ProgramDetail extends ProgramSummary {
  workouts: ProgramWorkoutEntry[];
  assignments: ProgramAssignmentEntry[];
}

/**
 * Athlete-facing programme detail (specs/19-programs — athlete read).
 * Metadata + ordered cycle + the athlete's OWN assignment context (status +
 * current week). Deliberately OMITS `assignments` — that's other clients'
 * data and must never leak to an athlete.
 */
export interface AthleteProgramDetail {
  id: string;
  name: string;
  description: string | null;
  durationWeeks: number | null;
  daysPerWeek: number;
  workoutCount: number;
  /** The athlete's assignment status for this programme. */
  status: string;
  startDate: string;
  endDate: string | null;
  /** 1-based calendar week the athlete is currently in. */
  week: number;
  workouts: ProgramWorkoutEntry[];
}

export interface ProgramInput {
  name: string;
  description?: string | null;
  durationWeeks: number | null;
  daysPerWeek: number;
  /** Ordered cycle; the same workout may repeat. Empty = draft shell. */
  workoutIds: string[];
}

export type DeleteProgramResult =
  | "deleted"
  | "not_found"
  | "has_live_assignments";

function toIso(d: Date | string | null): string | null {
  if (d === null) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

/**
 * Programme CRUD, trainer-scoped (specs/19-programs Phase 19.1).
 *
 * Every method takes the owning trainer's id first and folds
 * `created_by = trainerId` into the WHERE, so an un-owned programme is
 * indistinguishable from a missing one (handlers return 404 — no existence
 * leak, per requirements AC 1.6).
 */
export class ProgramRepository {
  async list(trainerId: string): Promise<ProgramSummary[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: workoutPrograms.id,
        name: workoutPrograms.name,
        description: workoutPrograms.description,
        durationWeeks: workoutPrograms.durationWeeks,
        daysPerWeek: workoutPrograms.daysPerWeek,
        createdAt: workoutPrograms.createdAt,
        updatedAt: workoutPrograms.updatedAt,
        workoutCount: sql<number>`count(distinct ${programWorkouts.id})::int`,
        activeClientCount: sql<number>`count(distinct ${programAssignments.clientId}) filter (where ${programAssignments.status} in ('assigned', 'started'))::int`,
      })
      .from(workoutPrograms)
      .leftJoin(
        programWorkouts,
        eq(programWorkouts.programId, workoutPrograms.id),
      )
      .leftJoin(
        programAssignments,
        eq(programAssignments.programId, workoutPrograms.id),
      )
      .where(eq(workoutPrograms.createdBy, trainerId))
      // Group by ordinal-safe plain column refs (cf.
      // reference_drizzle_groupby_param_bug — no reused sql`` params here).
      .groupBy(workoutPrograms.id)
      .orderBy(asc(workoutPrograms.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      durationWeeks: r.durationWeeks,
      daysPerWeek: r.daysPerWeek,
      workoutCount: r.workoutCount,
      activeClientCount: r.activeClientCount,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    }));
  }

  async get(
    trainerId: string,
    id: string,
    today: string,
  ): Promise<ProgramDetail | null> {
    const db = getDb();
    return this.fetchDetail(db, trainerId, id, today);
  }

  /**
   * Athlete-scoped programme read (specs/19-programs — athlete view). Returns
   * the programme + its ordered workout cycle ONLY when the caller has an
   * assignment to it (any status — a completed/skipped programme stays
   * viewable as history). Authorisation is the assignment itself: no
   * assignment → null (→ 404, no existence leak, mirrors the coach 404).
   * NEVER returns other clients' assignments.
   */
  async getForAthlete(
    athleteId: string,
    id: string,
    today: string,
  ): Promise<AthleteProgramDetail | null> {
    const db = getDb();

    // Prefer the most-recent assignment (a re-assigned programme keeps the
    // latest start date / status for the week computation).
    const assignmentRows = await db
      .select({
        startDate: programAssignments.startDate,
        endDate: programAssignments.endDate,
        status: programAssignments.status,
      })
      .from(programAssignments)
      .where(
        and(
          eq(programAssignments.programId, id),
          eq(programAssignments.clientId, athleteId),
        ),
      )
      .orderBy(desc(programAssignments.createdAt))
      .limit(1);
    const assignment = assignmentRows[0];
    if (!assignment) return null;

    const programRows = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, id))
      .limit(1);
    const program = programRows[0];
    if (!program) return null;

    const structure = await db
      .select({
        id: programWorkouts.id,
        workoutId: programWorkouts.workoutId,
        position: programWorkouts.position,
        name: workouts.name,
        estimatedDurationMinutes: workouts.estimatedDurationMinutes,
      })
      .from(programWorkouts)
      .innerJoin(workouts, eq(workouts.id, programWorkouts.workoutId))
      .where(eq(programWorkouts.programId, id))
      .orderBy(asc(programWorkouts.position));

    return {
      id: program.id,
      name: program.name,
      description: program.description,
      durationWeeks: program.durationWeeks,
      daysPerWeek: program.daysPerWeek,
      workoutCount: structure.length,
      status: assignment.status,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      week: currentWeek(assignment.startDate, today, program.durationWeeks),
      workouts: structure.map((s) => ({
        id: s.id,
        workoutId: s.workoutId,
        position: s.position,
        name: s.name,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
      })),
    };
  }

  async create(
    trainerId: string,
    input: ProgramInput,
    today: string,
  ): Promise<ProgramDetail | { error: "invalid_workouts" }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      if (!(await this.workoutsReadable(tx, trainerId, input.workoutIds))) {
        return { error: "invalid_workouts" as const };
      }

      const [program] = await tx
        .insert(workoutPrograms)
        .values({
          name: input.name,
          description: input.description ?? null,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          createdBy: trainerId,
        })
        .returning();

      await this.insertStructure(tx, program.id, input.workoutIds);

      return (await this.fetchDetail(tx, trainerId, program.id, today))!;
    });
  }

  /**
   * Metadata update + optional atomic structure replace. Structure edits
   * affect FUTURE materialisation only (requirements AC 1.4) — already-
   * materialised occurrences are untouched by design.
   */
  async update(
    trainerId: string,
    id: string,
    input: Partial<ProgramInput>,
    today: string,
  ): Promise<ProgramDetail | null | { error: "invalid_workouts" }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      if (
        input.workoutIds &&
        !(await this.workoutsReadable(tx, trainerId, input.workoutIds))
      ) {
        return { error: "invalid_workouts" as const };
      }

      // Ownership folded into the UPDATE WHERE — zero rows means not-found
      // OR not-owner, both surfaced as null (→ 404).
      const [updated] = await tx
        .update(workoutPrograms)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.durationWeeks !== undefined
            ? { durationWeeks: input.durationWeeks }
            : {}),
          ...(input.daysPerWeek !== undefined
            ? { daysPerWeek: input.daysPerWeek }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workoutPrograms.id, id),
            eq(workoutPrograms.createdBy, trainerId),
          ),
        )
        .returning();

      if (!updated) return null;

      if (input.workoutIds) {
        await tx
          .delete(programWorkouts)
          .where(eq(programWorkouts.programId, id));
        await this.insertStructure(tx, id, input.workoutIds);
      }

      return (await this.fetchDetail(tx, trainerId, id, today))!;
    });
  }

  /** 409 while live assignments exist (requirements AC 1.5). */
  async delete(trainerId: string, id: string): Promise<DeleteProgramResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const live = await tx
        .select({ id: programAssignments.id })
        .from(programAssignments)
        .where(
          and(
            eq(programAssignments.programId, id),
            inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
          ),
        )
        .limit(1);
      if (live[0]) return "has_live_assignments";

      const deleted = await tx
        .delete(workoutPrograms)
        .where(
          and(
            eq(workoutPrograms.id, id),
            eq(workoutPrograms.createdBy, trainerId),
          ),
        )
        .returning();
      return deleted.length > 0 ? "deleted" : "not_found";
    });
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  /**
   * Every workout referenced by a programme must be readable by the coach:
   * authored by them or public (requirements AC 1.2). Friends-visibility
   * does NOT qualify — a friendship can end after assignment.
   */
  private async workoutsReadable(
    db: DbOrTx,
    trainerId: string,
    workoutIds: string[],
  ): Promise<boolean> {
    const unique = [...new Set(workoutIds)];
    if (unique.length === 0) return true;
    const rows = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(
        and(
          inArray(workouts.id, unique),
          or(
            eq(workouts.createdBy, trainerId),
            eq(workouts.visibility, "public"),
          ),
        ),
      );
    return rows.length === unique.length;
  }

  private async insertStructure(
    db: DbOrTx,
    programId: string,
    workoutIds: string[],
  ): Promise<void> {
    if (workoutIds.length === 0) return;
    await db.insert(programWorkouts).values(
      workoutIds.map((workoutId, position) => ({
        programId,
        workoutId,
        position,
      })),
    );
  }

  private async fetchDetail(
    db: DbOrTx,
    trainerId: string,
    id: string,
    today: string,
  ): Promise<ProgramDetail | null> {
    const programRows = await db
      .select()
      .from(workoutPrograms)
      .where(
        and(
          eq(workoutPrograms.id, id),
          eq(workoutPrograms.createdBy, trainerId),
        ),
      )
      .limit(1);
    const program = programRows[0];
    if (!program) return null;

    const [structure, assignments] = await Promise.all([
      db
        .select({
          id: programWorkouts.id,
          workoutId: programWorkouts.workoutId,
          position: programWorkouts.position,
          name: workouts.name,
          estimatedDurationMinutes: workouts.estimatedDurationMinutes,
        })
        .from(programWorkouts)
        .innerJoin(workouts, eq(workouts.id, programWorkouts.workoutId))
        .where(eq(programWorkouts.programId, id))
        .orderBy(asc(programWorkouts.position)),
      db
        .select({
          id: programAssignments.id,
          clientId: programAssignments.clientId,
          clientName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
          startDate: programAssignments.startDate,
          endDate: programAssignments.endDate,
          status: programAssignments.status,
        })
        .from(programAssignments)
        .leftJoin(profiles, eq(profiles.id, programAssignments.clientId))
        .where(eq(programAssignments.programId, id))
        .orderBy(asc(programAssignments.createdAt)),
    ]);

    return {
      id: program.id,
      name: program.name,
      description: program.description,
      durationWeeks: program.durationWeeks,
      daysPerWeek: program.daysPerWeek,
      workoutCount: structure.length,
      activeClientCount: assignments.filter((a) =>
        (LIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status),
      ).length,
      createdAt: toIso(program.createdAt),
      updatedAt: toIso(program.updatedAt),
      workouts: structure.map((s) => ({
        id: s.id,
        workoutId: s.workoutId,
        position: s.position,
        name: s.name,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        clientId: a.clientId,
        clientName: a.clientName ?? "",
        clientInitials: initialsFromName(a.clientName),
        avatarUrl: a.avatarUrl,
        startDate: a.startDate,
        endDate: a.endDate,
        status: a.status,
        currentWeek: currentWeek(a.startDate, today, program.durationWeeks),
      })),
    };
  }
}
