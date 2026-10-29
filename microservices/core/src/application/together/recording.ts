import { and, eq } from "drizzle-orm";
import {
  togetherJobs as jobs,
  togetherParticipants as participants,
  togetherSessions as sessions,
  togetherEvents as events,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { withActors, requireTogether } from "./shared";
import {
  SessionRepository,
  type RecordSessionInput,
} from "../repositories/sessionRepository";
import { PersonalRecordsRepository } from "../repositories/personalRecordsRepository";
import { StreakRepository } from "../repositories/streakRepository";
import { VolumeRepository } from "../repositories/volumeRepository";
import { materializeTogetherExercise } from "./exerciseRecording";
import { recomputeUserVolume } from "../progress/recompute";
/** Persisted frozen participant state is the source of truth. Record, PRs and mapping commit together. */
export async function processTogetherJob(id: string, userId: string) {
  const known = await getDb()
    .select()
    .from(participants)
    .where(eq(participants.sessionId, id));
  await withActors(
    known.map((p) => p.userId),
    async (tx) => {
      const [s] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .for("update");
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.sessionId, id), eq(jobs.userId, userId)))
        .for("update");
      requireTogether(s && job, "NOT_FOUND", 404);
      if (job.status === "saved") return;
      const [p] = await tx
        .select()
        .from(participants)
        .where(
          and(eq(participants.sessionId, id), eq(participants.userId, userId)),
        );
      requireTogether(
        p?.status === "finalizing" && p.frozenPlan,
        "INVALID_STATE",
        409,
      );
      const recordedExercises: RecordSessionInput["exercises"] = [];
      for (const plan of p.frozenPlan.exercises) {
        const ex = p.execution.exercises.find(
          (e) => e.planExerciseId === plan.planExerciseId,
        );
        const sets = ex?.sets.filter((s) => s.completed) ?? [];
        if (!sets.length) continue;
        const exerciseId = await materializeTogetherExercise(
          tx,
          userId,
          ex?.substituteExerciseId ?? plan.exerciseId,
          p.exerciseDefinitions[ex?.substituteExerciseId ?? plan.exerciseId],
        );
        const originalExerciseId = ex?.substituteExerciseId
          ? await materializeTogetherExercise(
              tx,
              userId,
              plan.exerciseId,
              p.exerciseDefinitions[plan.exerciseId],
            )
          : null;
        recordedExercises.push({
          exerciseId,
          category:
            p.exerciseDefinitions[ex?.substituteExerciseId ?? plan.exerciseId]
              .category,
          isSubstituted: !!ex?.substituteExerciseId,
          originalExerciseId,
          sortOrder: plan.order,
          sets: sets.map((set, i) => ({
            setNumber: i + 1,
            reps: set.reps,
            weightKg: set.weightKg,
            isCompleted: true,
            completedAt: job.completedAt.toISOString(),
          })),
        });
      }
      const payload: RecordSessionInput = {
        clientSessionId: job.clientRecordId,
        name: p.frozenPlan.name,
        startedAt: s.createdAt.toISOString(),
        completedAt: job.completedAt.toISOString(),
        status: "completed",
        exercises: recordedExercises,
      };
      const prs = new PersonalRecordsRepository();
      await new SessionRepository().recordSession(
        userId,
        payload,
        (uid, sid, tx) => prs.recordPRsForSession(uid, sid, tx),
        undefined,
        {
          transaction: tx,
          togetherFinalization: true,
          afterRecord: async (uid, historyId, recordTx) => {
            await recordTx
              .update(participants)
              .set({
                status: "saved",
                historyId,
                exerciseDefinitions: p.exerciseDefinitions,
              })
              .where(
                and(
                  eq(participants.sessionId, id),
                  eq(participants.userId, uid),
                ),
              );
            await recordTx
              .update(jobs)
              .set({ status: "saved" })
              .where(and(eq(jobs.sessionId, id), eq(jobs.userId, uid)));
            await recordTx
              .update(sessions)
              .set({ revision: s.revision + 1 })
              .where(eq(sessions.id, id));
            await recordTx.insert(events).values({
              sessionId: id,
              revision: s.revision + 1,
              event: { type: "completion_saved", userId: uid },
            });
          },
        },
      );
    },
  );
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.sessionId, id), eq(jobs.userId, userId)));
  if (!job.effectsDone) {
    // These rebuild from durable history and throw on failure; never mark swallowed errors done.
    await new StreakRepository().reconcileWorkoutStreakHistory(userId);
    await recomputeUserVolume(new VolumeRepository(), userId, new Date());
    await getDb()
      .update(jobs)
      .set({ effectsDone: true })
      .where(and(eq(jobs.sessionId, id), eq(jobs.userId, userId)));
  }
}
