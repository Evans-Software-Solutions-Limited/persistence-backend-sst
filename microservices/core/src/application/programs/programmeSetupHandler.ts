import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  programAssignments,
  ptClientRelationships,
  workoutPrograms,
} from "@persistence/db";
import type {
  SetupItemInput,
  SetupSectionHandler,
} from "../coaching/setupSections";
import { todayIso } from "../trainers/programs/shared";
import { assignProgrammeInSequence } from "./assignProgrammeInSequence";

/**
 * Set-up section `programme` (PER-108's hook, design A D4 step 6; PER-112).
 * A coach prepares an invited client's profile with their own programmes. On
 * accept, each item becomes a `sequence` programme assignment (no dates,
 * programme order with Next) through `assignProgrammeInSequence`, exactly
 * once per set-up item.
 *
 * Item shape: `{ refId: <coach's workout_programs.id>, config: {
 * sessionsPerWeek? } }`. `sessionsPerWeek` (1–14) is read by the accept flow
 * to seed the client's training target (design B).
 */

/**
 * Workouts in the programme. Table names are written out: Drizzle leaves
 * columns unqualified in a single-table select, which would bind the outer
 * `id` to `program_workouts` inside this correlated subquery.
 */
const workoutCount = sql<number>`(select count(*)::int from program_workouts pw where pw.program_id = "workout_programs"."id")`;

const SESSIONS_MIN = 1;
const SESSIONS_MAX = 14;

export const programmeSetupHandler: SetupSectionHandler = {
  async validate(db, trainerId, item: SetupItemInput) {
    if (!item.refId) {
      return {
        ok: false,
        message: "A programme needs refId (one of your programmes)",
      };
    }
    const rows = await db
      .select({
        id: workoutPrograms.id,
        workouts: workoutCount,
      })
      .from(workoutPrograms)
      .where(
        and(
          eq(workoutPrograms.id, item.refId),
          eq(workoutPrograms.createdBy, trainerId),
        ),
      )
      .limit(1);
    const program = rows[0];
    if (!program) {
      return { ok: false, message: "refId must be one of your programmes" };
    }
    if (!(Number(program.workouts) > 0)) {
      return {
        ok: false,
        message: "Add workouts to the programme before setting it up",
      };
    }
    const config: Record<string, unknown> = {};
    const sessions = item.config.sessionsPerWeek;
    if (sessions !== undefined && sessions !== null) {
      if (
        !Number.isInteger(sessions) ||
        (sessions as number) < SESSIONS_MIN ||
        (sessions as number) > SESSIONS_MAX
      ) {
        return {
          ok: false,
          message: `config.sessionsPerWeek must be an integer ${SESSIONS_MIN}–${SESSIONS_MAX}`,
        };
      }
      config.sessionsPerWeek = sessions;
    }
    return {
      ok: true,
      item: { refId: program.id, config, sortOrder: item.sortOrder },
    };
  },

  async materialise(ctx, item) {
    if (!item.refId) return { refId: null };
    const result = await assignProgrammeInSequence({
      assignerId: ctx.trainerId,
      clientId: ctx.clientId,
      programId: item.refId,
      today: todayIso(),
      tx: ctx.tx,
    });
    // Deleted or emptied after set-up, or already live: nothing to add.
    if ("error" in result) return { refId: null };
    return { refId: result.assignment.id };
  },

  async copyFromClient(db, trainerId, clientId) {
    // Only this coach's live programmes for that client, and only while they
    // still coach them. Another coach's programmes are theirs.
    const rows = await db
      .select({ programId: programAssignments.programId })
      .from(programAssignments)
      .innerJoin(
        ptClientRelationships,
        and(
          eq(ptClientRelationships.trainerId, programAssignments.assignedBy),
          eq(ptClientRelationships.clientId, programAssignments.clientId),
          eq(ptClientRelationships.status, "active"),
        ),
      )
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .where(
        and(
          eq(programAssignments.assignedBy, trainerId),
          eq(programAssignments.clientId, clientId),
          inArray(programAssignments.status, ["assigned", "started"]),
          eq(workoutPrograms.createdBy, trainerId),
        ),
      )
      .orderBy(asc(programAssignments.createdAt));
    return rows.map((r, i) => ({
      refId: r.programId,
      config: {},
      sortOrder: i,
    }));
  },

  async preview(db, items) {
    const ids = items.map((i) => i.refId).filter((id): id is string => !!id);
    if (ids.length === 0) return { programmes: [] };
    const rows = await db
      .select({
        id: workoutPrograms.id,
        name: workoutPrograms.name,
        workouts: workoutCount,
      })
      .from(workoutPrograms)
      .where(inArray(workoutPrograms.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      programmes: ids
        .filter((id) => byId.has(id))
        .map((id) => ({
          name: byId.get(id)!.name,
          workouts: Number(byId.get(id)!.workouts) || 0,
        })),
    };
  },
};
