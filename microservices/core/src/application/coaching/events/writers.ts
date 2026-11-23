import { and, eq, isNull } from "drizzle-orm";
import {
  exerciseSets,
  exercises,
  personalRecords,
  profiles,
  ptClientRelationships,
  sessionExercises,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { deliverCoachEvents, recordCoachEvent } from "./coachEvents";

/**
 * Event writers that hook into existing code paths (PER-117, design C D4).
 * Each is a side effect only: it never changes the response of the path it is
 * called from, and the session hook never fails the request.
 */

interface ActiveCoach {
  trainerId: string;
  relationshipId: string;
  activatedAt: Date | null;
}

/** The athlete's active, human coaches whose accounts aren't deleted. */
export async function activeCoachesOf(
  db: DbOrTx,
  clientId: string,
): Promise<ActiveCoach[]> {
  return db
    .select({
      trainerId: ptClientRelationships.trainerId,
      relationshipId: ptClientRelationships.id,
      activatedAt: ptClientRelationships.activatedAt,
    })
    .from(ptClientRelationships)
    .innerJoin(profiles, eq(profiles.id, ptClientRelationships.trainerId))
    .where(
      and(
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
        isNull(profiles.deletedAt),
      ),
    );
}

/**
 * A completed workout: one `workout_completed` event per active coach, with
 * the athlete's rating and note, plus one `record_hit` event per coach when
 * the workout set records. Called after the session write has committed
 * (`PATCH /sessions/:id` → completed, `POST /sessions/record`). Keyed by the
 * session, so a replay or a second completion writes nothing new. A workout
 * finished before this coach's coaching started is not theirs to hear about.
 */
export async function recordWorkoutCompleted(
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const db = getDb();
  const sessions = await db
    .select({
      id: workoutSessions.id,
      name: workoutSessions.name,
      status: workoutSessions.status,
      completedAt: workoutSessions.completedAt,
      rating: workoutSessions.sessionRating,
      difficulty: workoutSessions.difficultyRanking,
      note: workoutSessions.userNotes,
      durationSeconds: workoutSessions.totalDurationSeconds,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.userId, userId),
      ),
    )
    .limit(1);
  const session = sessions[0];
  if (!session || session.status !== "completed") return [];
  const coaches = await activeCoachesOf(db, userId);
  if (coaches.length === 0) return [];

  const records = await db
    .select({
      exerciseId: personalRecords.exerciseId,
      exerciseName: exercises.name,
      recordType: personalRecords.recordType,
      value: personalRecords.value,
    })
    .from(personalRecords)
    .innerJoin(exerciseSets, eq(exerciseSets.id, personalRecords.setId))
    .innerJoin(
      sessionExercises,
      eq(sessionExercises.id, exerciseSets.sessionExerciseId),
    )
    .innerJoin(exercises, eq(exercises.id, personalRecords.exerciseId))
    .where(
      and(
        eq(personalRecords.userId, userId),
        eq(sessionExercises.sessionId, sessionId),
      ),
    );

  const occurredAt = session.completedAt ?? new Date();
  const pending: string[] = [];
  for (const coach of coaches) {
    if (coach.activatedAt && occurredAt < coach.activatedAt) continue;
    const base = {
      trainerId: coach.trainerId,
      clientId: userId,
      relationshipId: coach.relationshipId,
      entityType: "workout_session",
      entityId: sessionId,
      occurredAt,
    };
    const workout = await recordCoachEvent(db, {
      ...base,
      kind: "workout_completed",
      payload: {
        sessionId,
        workoutName: session.name,
        rating: session.rating,
        difficulty: session.difficulty,
        note: session.note,
        durationSeconds: session.durationSeconds,
      },
      dedupeKey: `workout_completed:${sessionId}`,
    });
    if (workout) pending.push(workout);
    if (records.length > 0) {
      const record = await recordCoachEvent(db, {
        ...base,
        kind: "record_hit",
        payload: {
          sessionId,
          workoutName: session.name,
          records: records.map((r) => ({
            exerciseId: r.exerciseId,
            exerciseName: r.exerciseName,
            recordType: r.recordType,
            value: Number(r.value),
          })),
        },
        dedupeKey: `record_hit:${sessionId}`,
      });
      if (record) pending.push(record);
    }
  }
  return pending;
}

/**
 * `recordWorkoutCompleted` then the pushes, for the two session handlers.
 * Never throws: the session is already saved.
 */
export async function safeRecordWorkoutCompleted(
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    await deliverCoachEvents(await recordWorkoutCompleted(userId, sessionId));
  } catch (err) {
    console.error("[coach-events] workout completed event failed", {
      userId,
      sessionId,
      error: err,
    });
  }
}

/**
 * A client accepted this coach (inside the accept transaction). Keyed by the
 * coaching cycle, so a replayed accept writes nothing new and a client who
 * rejoins later is announced again. `noPush` where the accept path already
 * pushes the coach itself.
 */
export async function recordClientAccepted(
  tx: DbOrTx,
  ref: { trainerId: string; clientId: string; relationshipId: string },
  options: { noPush?: boolean } = {},
  now: Date = new Date(),
): Promise<string | null> {
  const rows = await tx
    .select({ activatedAt: ptClientRelationships.activatedAt })
    .from(ptClientRelationships)
    .where(eq(ptClientRelationships.id, ref.relationshipId))
    .limit(1);
  const cycle = rows[0]?.activatedAt?.getTime() ?? now.getTime();
  return recordCoachEvent(
    tx,
    {
      ...ref,
      kind: "client_accepted",
      entityType: "relationship",
      entityId: ref.relationshipId,
      payload: {},
      dedupeKey: `client_accepted:${ref.relationshipId}:c${cycle}`,
      noPush: options.noPush,
    },
    now,
  );
}
