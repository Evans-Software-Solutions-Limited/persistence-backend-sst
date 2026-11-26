import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  coachClientProfiles,
  coachClientSettings,
  coachEvents,
  profiles,
  programAssignments,
  ptClientRelationships,
  trainerInviteCodes,
  workoutPrograms,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { AdherenceRepository } from "../../../adherence/adherenceRepository";
import {
  addDays,
  computeAdherence,
  type AdherenceInput,
} from "../../../adherence/computeAdherence";
import { localDateIn, safeTimeZone, zonedInstant } from "../zonedTime";
import { deliverCoachEvents, recordCoachEvent } from "../../events/coachEvents";
import type { SchedulerJob } from "../coachScheduler";
import { PAGE_SIZES } from "./pageSizes";

/**
 * Coach events the scheduler finds rather than a request writes (PER-117,
 * design C D4): an invite that expired unaccepted (design A), a programme
 * about to end, and a client behind on training (design B's adherence). Each
 * event's dedupe key makes the job safe to run again.
 */

const DAY_MS = 86_400_000;
/** An invite that expired longer ago than this is never announced. */
const EXPIRY_LOOKBACK_MS = 3 * DAY_MS;
/** "Ends soon": the programme's last day is within this many days. */
export const PROGRAMME_ENDING_DAYS = 7;
/** Training behind is raised at most once per client per this window. */
const BEHIND_EVERY_MS = 7 * DAY_MS;

export const inviteExpiryJob: SchedulerJob = {
  name: "invite_expiry",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const db = getDb();
    const events: string[] = [];
    let checked = 0;
    // Rows already announced drop out (their event exists), so each page is
    // new and the loop drains every expired invite (Inspector Brad, #548).
    for (;;) {
      const rows = await db
        .select({
          codeId: trainerInviteCodes.id,
          trainerId: trainerInviteCodes.trainerId,
          expiresAt: trainerInviteCodes.expiresAt,
          profileId: coachClientProfiles.id,
          displayName: coachClientProfiles.displayName,
        })
        .from(trainerInviteCodes)
        .innerJoin(
          coachClientProfiles,
          eq(coachClientProfiles.id, trainerInviteCodes.clientProfileId),
        )
        .where(
          and(
            eq(trainerInviteCodes.status, "active"),
            lte(trainerInviteCodes.expiresAt, now),
            gt(
              trainerInviteCodes.expiresAt,
              new Date(now.getTime() - EXPIRY_LOOKBACK_MS),
            ),
            eq(coachClientProfiles.status, "invited"),
            eq(coachClientProfiles.trainerId, trainerInviteCodes.trainerId),
            isNull(coachClientProfiles.deletedAt),
            sql`not exists (
            select 1 from ${coachEvents}
            where ${coachEvents.trainerId} = ${trainerInviteCodes.trainerId}
              and ${coachEvents.dedupeKey} = 'invite_expired:' || ${trainerInviteCodes.id}
          )`,
          ),
        )
        .orderBy(asc(trainerInviteCodes.expiresAt))
        .limit(PAGE_SIZES.expiredInvites);
      checked += rows.length;
      for (const r of rows) {
        const id = await recordCoachEvent(
          db,
          {
            trainerId: r.trainerId,
            clientId: null,
            relationshipId: null,
            kind: "invite_expired",
            entityType: "coach_client_profile",
            entityId: r.profileId,
            payload: {
              profileId: r.profileId,
              displayName: r.displayName,
              expiredAt: r.expiresAt.toISOString(),
            },
            occurredAt: r.expiresAt,
            dedupeKey: `invite_expired:${r.codeId}`,
          },
          now,
        );
        if (id) events.push(id);
      }
      if (rows.length < PAGE_SIZES.expiredInvites) break;
    }
    await deliverCoachEvents(events, dispatcher);
    return { checked, events: events.length };
  },
};

/**
 * Programmes with an end date in the next 7 days, assigned by a coach who
 * still coaches the client. Programmes without dates (design G, `sequence`)
 * have no end date: a finite one raises this instead when two or fewer of its
 * workouts remain (PER-112), once per assignment.
 */
export const SEQUENCE_ENDING_REMAINING = 2;
export const programmeEndingJob: SchedulerJob = {
  name: "programme_ending",
  cadence: "daily",
  async run({ now, dispatcher }) {
    const db = getDb();
    const today = now.toISOString().slice(0, 10);
    const events: string[] = [];
    let checked = 0;
    // Rows already announced drop out (their event exists), so each page is
    // new and the loop drains every programme (Inspector Brad, #548).
    for (;;) {
      const rows = await db
        .select({
          assignmentId: programAssignments.id,
          programId: programAssignments.programId,
          programName: workoutPrograms.name,
          clientId: programAssignments.clientId,
          endDate: programAssignments.endDate,
          trainerId: ptClientRelationships.trainerId,
          relationshipId: ptClientRelationships.id,
        })
        .from(programAssignments)
        .innerJoin(
          workoutPrograms,
          eq(workoutPrograms.id, programAssignments.programId),
        )
        .innerJoin(
          ptClientRelationships,
          and(
            eq(ptClientRelationships.trainerId, programAssignments.assignedBy),
            eq(ptClientRelationships.clientId, programAssignments.clientId),
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
          ),
        )
        .where(
          and(
            inArray(programAssignments.status, ["assigned", "started"]),
            isNotNull(programAssignments.endDate),
            gte(programAssignments.endDate, today),
            lte(
              programAssignments.endDate,
              addDays(today, PROGRAMME_ENDING_DAYS),
            ),
            sql`not exists (
            select 1 from ${coachEvents}
            where ${coachEvents.trainerId} = ${ptClientRelationships.trainerId}
              and ${coachEvents.dedupeKey} = 'programme_ending:' || ${programAssignments.id} || ':' || ${programAssignments.endDate}
          )`,
          ),
        )
        .orderBy(asc(programAssignments.endDate))
        .limit(PAGE_SIZES.endingProgrammes);
      checked += rows.length;
      for (const r of rows) {
        const id = await recordCoachEvent(
          db,
          {
            trainerId: r.trainerId,
            clientId: r.clientId,
            relationshipId: r.relationshipId,
            kind: "programme_ending",
            entityType: "program_assignment",
            entityId: r.assignmentId,
            payload: {
              assignmentId: r.assignmentId,
              programId: r.programId,
              programName: r.programName,
              endDate: r.endDate,
            },
            dedupeKey: `programme_ending:${r.assignmentId}:${r.endDate}`,
          },
          now,
        );
        if (id) events.push(id);
      }
      if (rows.length < PAGE_SIZES.endingProgrammes) break;
    }
    checked += await announceSequenceEndings(db, now, events);
    await deliverCoachEvents(events, dispatcher);
    return { checked, events: events.length };
  },
};

/**
 * PER-112 (design G part 2): finite `sequence` programmes with two or fewer
 * workouts left, assigned by a coach who still coaches the client. Pages like
 * the dated query; announced rows drop out through their dedupe key.
 */
async function announceSequenceEndings(
  db: ReturnType<typeof getDb>,
  now: Date,
  events: string[],
): Promise<number> {
  let checked = 0;
  const remaining = sql<number>`(select count(*)::int from workout_assignments wa_left where wa_left.program_assignment_id = ${programAssignments.id} and wa_left.status in ('assigned', 'started'))`;
  for (;;) {
    const rows = await db
      .select({
        assignmentId: programAssignments.id,
        programId: programAssignments.programId,
        programName: workoutPrograms.name,
        clientId: programAssignments.clientId,
        trainerId: ptClientRelationships.trainerId,
        relationshipId: ptClientRelationships.id,
        remaining,
      })
      .from(programAssignments)
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .innerJoin(
        ptClientRelationships,
        and(
          eq(ptClientRelationships.trainerId, programAssignments.assignedBy),
          eq(ptClientRelationships.clientId, programAssignments.clientId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      )
      .where(
        and(
          eq(programAssignments.scheduleMode, "sequence"),
          inArray(programAssignments.status, ["assigned", "started"]),
          isNotNull(workoutPrograms.durationWeeks),
          sql`${remaining} between 1 and ${SEQUENCE_ENDING_REMAINING}`,
          sql`not exists (
            select 1 from ${coachEvents}
            where ${coachEvents.trainerId} = ${ptClientRelationships.trainerId}
              and ${coachEvents.dedupeKey} = 'programme_ending:' || ${programAssignments.id} || ':sequence'
          )`,
        ),
      )
      .orderBy(asc(programAssignments.id))
      .limit(PAGE_SIZES.endingProgrammes);
    checked += rows.length;
    for (const r of rows) {
      const id = await recordCoachEvent(
        db,
        {
          trainerId: r.trainerId,
          clientId: r.clientId,
          relationshipId: r.relationshipId,
          kind: "programme_ending",
          entityType: "program_assignment",
          entityId: r.assignmentId,
          payload: {
            assignmentId: r.assignmentId,
            programId: r.programId,
            programName: r.programName,
            endDate: null,
            remaining: Number(r.remaining),
          },
          dedupeKey: `programme_ending:${r.assignmentId}:sequence`,
        },
        now,
      );
      if (id) events.push(id);
    }
    if (rows.length < PAGE_SIZES.endingProgrammes) break;
  }
  return checked;
}

/**
 * Clients behind their sessions-per-week target over the last 7 days, using
 * the one shared adherence calculation (design B). Only clients the coach
 * tracks training for, with a target, and coached for the whole window (a
 * new client isn't behind on days before they joined). At most once per
 * client per 7 days.
 *
 * Judged on the 7 COMPLETE days up to the end of yesterday in the client's
 * zone: the job runs in the morning, when "today" has barely started, and a
 * window ending today would drop last week's session and flag a client who is
 * on schedule (Inspector Brad, #548).
 */
export function asOfEndOfYesterday(input: AdherenceInput): AdherenceInput {
  const tz = safeTimeZone(input.timeZone);
  const midnight = zonedInstant(localDateIn(input.now, tz), "00:00", tz);
  return { ...input, now: new Date(midnight.getTime() - 1) };
}

export const trainingBehindJob: SchedulerJob = {
  name: "training_behind",
  cadence: "daily",
  async run({ now, dispatcher }) {
    const db = getDb();
    const repo = new AdherenceRepository();
    const events: string[] = [];
    let behind = 0;
    let seen = 0;
    // Every coach who tracks training, a page at a time (keyset on id), so
    // no coach past a cap is skipped (Inspector Brad, #548).
    let after: string | null = null;
    for (;;) {
      const trainers: { trainerId: string }[] = await db
        .selectDistinct({ trainerId: ptClientRelationships.trainerId })
        .from(ptClientRelationships)
        .innerJoin(
          coachClientSettings,
          and(
            eq(coachClientSettings.relationshipId, ptClientRelationships.id),
            eq(coachClientSettings.trainerId, ptClientRelationships.trainerId),
          ),
        )
        .innerJoin(profiles, eq(profiles.id, ptClientRelationships.trainerId))
        .where(
          and(
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
            eq(coachClientSettings.trackTraining, true),
            isNotNull(coachClientSettings.sessionsPerWeek),
            isNull(profiles.deletedAt),
            ...(after ? [gt(ptClientRelationships.trainerId, after)] : []),
          ),
        )
        .orderBy(asc(ptClientRelationships.trainerId))
        .limit(PAGE_SIZES.behindTrainers);
      seen += trainers.length;
      for (const { trainerId } of trainers) {
        const subjects = (await repo.subjectsForTrainer(trainerId)).filter(
          (s) => s.settings.trackTraining && s.settings.sessionsPerWeek,
        );
        if (subjects.length === 0) continue;
        const inputs = await repo.loadMany(subjects, "7d", now);
        const recent = await db
          .select({ relationshipId: coachEvents.relationshipId })
          .from(coachEvents)
          .where(
            and(
              eq(coachEvents.trainerId, trainerId),
              eq(coachEvents.kind, "training_behind"),
              gt(
                coachEvents.occurredAt,
                new Date(now.getTime() - BEHIND_EVERY_MS),
              ),
            ),
          );
        const raised = new Set(recent.map((r) => r.relationshipId));
        for (const s of subjects) {
          const training = computeAdherence(
            asOfEndOfYesterday(inputs.get(s.relationshipId)!),
          ).training;
          if (!training || training.state !== "behind") continue;
          if (training.from !== addDays(training.to, -6)) continue;
          behind += 1;
          if (raised.has(s.relationshipId)) continue;
          const id = await recordCoachEvent(
            db,
            {
              trainerId,
              clientId: s.clientId,
              relationshipId: s.relationshipId,
              kind: "training_behind",
              entityType: "relationship",
              entityId: s.relationshipId,
              payload: {
                done: training.done,
                target: training.target,
                label: training.label,
              },
              dedupeKey: `training_behind:${s.relationshipId}:${training.to}`,
            },
            now,
          );
          if (id) events.push(id);
        }
      }
      if (trainers.length < PAGE_SIZES.behindTrainers) break;
      after = trainers[trainers.length - 1]!.trainerId;
    }
    await deliverCoachEvents(events, dispatcher);
    return { trainers: seen, behind, events: events.length };
  },
};
