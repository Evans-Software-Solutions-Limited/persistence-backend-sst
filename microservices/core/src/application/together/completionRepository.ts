import { randomUUID } from "node:crypto";
import { and, eq, lt, asc, sql } from "drizzle-orm";
import { TypeCompiler } from "elysia/type-system";
import { getDb } from "@persistence/db/client";
import {
  togetherReviewedResults as results,
  togetherOfflineExecutions as offline,
  togetherParticipants as participants,
  togetherSessions as sessions,
  togetherJobs as jobs,
  exercises,
  workoutSessions,
  togetherEvents as events,
  type TogetherPlan,
  type TogetherExecution,
  type TogetherExerciseDefinition,
} from "@persistence/db";
import { executionSchema } from "./types";
import {
  assertActorActive,
  requireTogether,
  replayMutation,
  togetherEnabled,
  withActors,
  type TogetherTx,
} from "./shared";
import { ExerciseRepository } from "../repositories/exerciseRepository";
import {
  writeRecoveredHistory,
  recomputeRecoveredEffects,
} from "./recoveredRecording";
const executionValidator = TypeCompiler.Compile(executionSchema);
const ownerSession = (actor: string, id: string) =>
  and(eq(results.userId, actor), eq(results.sessionId, id));

/** A review is explicit, owner-only acceptance; uploading a journal never calls this. */
export class TogetherCompletionRepository {
  private enabled() {
    requireTogether(togetherEnabled(), "NOT_FOUND", 404);
  }
  private async definitions(
    tx: TogetherTx,
    actor: string,
    plan: TogetherPlan,
    execution: TogetherExecution,
    existing: Record<string, TogetherExerciseDefinition>,
  ) {
    requireTogether(executionValidator.Check(execution), "INVALID_SCHEMA", 400);
    requireTogether(
      new Set(execution.exercises.map((e) => e.planExerciseId)).size ===
        execution.exercises.length,
      "INVALID_SCHEMA",
      400,
    );
    for (const e of execution.exercises) {
      requireTogether(
        plan.exercises.some((p) => p.planExerciseId === e.planExerciseId),
        "INVALID_SCHEMA",
        400,
      );
      requireTogether(
        new Set(e.sets.map((s) => s.setId)).size === e.sets.length,
        "INVALID_SCHEMA",
        400,
      );
    }
    const definitions = structuredClone(existing);
    const ids = new Set([
      ...plan.exercises.map((e) => e.exerciseId),
      ...execution.exercises.flatMap((e) =>
        e.substituteExerciseId ? [e.substituteExerciseId] : [],
      ),
    ]);
    for (const id of ids) {
      if (definitions[id]) continue;
      const [source] = await tx
        .select({
          name: exercises.name,
          category: exercises.category,
          primaryMuscles: exercises.primaryMuscles,
          createdBy: exercises.createdBy,
        })
        .from(exercises)
        .where(
          and(
            eq(exercises.id, id),
            new ExerciseRepository().buildVisibilityCondition(actor),
          ),
        );
      requireTogether(source, "EXERCISE_UNAVAILABLE", 409);
      definitions[id] = {
        ...source,
        primaryMuscles: source.primaryMuscles ?? [],
      };
    }
    return definitions;
  }
  private async save(
    tx: TogetherTx,
    actor: string,
    id: string,
    input: {
      revision: number;
      plan: TogetherPlan;
      execution: TogetherExecution;
      definitions: Record<string, TogetherExerciseDefinition>;
      startedAt: Date;
      completedAt: Date;
      historyId?: string | null;
      clientRecordId?: string;
    },
  ) {
    const [prior] = await tx
      .select()
      .from(results)
      .where(ownerSession(actor, id));
    const definitions = await this.definitions(
      tx,
      actor,
      input.plan,
      input.execution,
      { ...prior?.exerciseDefinitions, ...input.definitions },
    );
    const completedAt = prior?.completedAt ?? input.completedAt;
    requireTogether(
      Number.isFinite(completedAt.getTime()) &&
        completedAt >= input.startedAt &&
        completedAt.getTime() <= Date.now(),
      "INVALID_SCHEMA",
      400,
    );
    const clientRecordId =
      prior?.clientRecordId ?? input.clientRecordId ?? randomUUID();
    if (!prior?.historyId && !input.historyId) {
      const [collision] = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, actor),
            eq(workoutSessions.clientSessionId, clientRecordId),
          ),
        );
      requireTogether(!collision, "HISTORY_IDENTITY_CONFLICT", 409);
    }
    const historyId = await writeRecoveredHistory(tx, actor, {
      historyId: prior?.historyId ?? input.historyId ?? null,
      clientRecordId,
      plan: input.plan,
      execution: input.execution,
      exerciseDefinitions: definitions,
      startedAt: input.startedAt,
      completedAt,
    });
    const version = (prior?.effectsVersion ?? 0) + 1;
    await tx
      .insert(results)
      .values({
        userId: actor,
        sessionId: id,
        clientRecordId,
        historyId,
        reviewedRevision: input.revision,
        completedAt,
        effectsVersion: version,
        exerciseDefinitions: definitions,
      })
      .onConflictDoUpdate({
        target: [results.userId, results.sessionId],
        set: {
          historyId,
          reviewedRevision: input.revision,
          effectsVersion: version,
          exerciseDefinitions: definitions,
        },
      });
    const hasWork = input.execution.exercises.some((e) =>
      e.sets.some((s) => s.completed),
    );
    return {
      status: hasWork ? ("saved" as const) : ("finished_empty" as const),
      historyId,
      reviewedRevision: input.revision,
      effectsPending: true as const,
      sharingActive: false as const,
    };
  }
  async completeOffline(
    actor: string,
    executionId: string,
    key: string,
    body: { expectedRevision: number; completedAt: string },
  ) {
    this.enabled();
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      const [candidate] = await tx
        .select()
        .from(offline)
        .where(
          and(eq(offline.userId, actor), eq(offline.executionId, executionId)),
        );
      requireTogether(candidate, "NOT_FOUND", 404);
      return replayMutation(
        tx,
        actor,
        `offline:complete:${executionId}`,
        key,
        body,
        async () => {
          requireTogether(
            candidate.revision === body.expectedRevision,
            "VERSION_CONFLICT",
            409,
          );
          const [prior] = await tx
            .select()
            .from(results)
            .where(ownerSession(actor, candidate.sessionId));
          if (prior?.reviewedRevision === candidate.revision)
            return {
              status: candidate.execution.exercises.some((e) =>
                e.sets.some((s) => s.completed),
              )
                ? ("saved" as const)
                : ("finished_empty" as const),
              historyId: prior.historyId,
              reviewedRevision: prior.reviewedRevision,
              effectsPending: prior.effectsDoneVersion < prior.effectsVersion,
              sharingActive: false as const,
            };
          return this.save(tx, actor, candidate.sessionId, {
            revision: candidate.revision,
            plan: candidate.plan,
            execution: candidate.execution,
            definitions: {},
            startedAt: candidate.startedAt,
            completedAt: new Date(body.completedAt),
            clientRecordId: executionId,
          });
        },
      );
    });
  }
  async reviewCloud(
    actor: string,
    id: string,
    key: string,
    body: { expectedOwnRevision: number; execution: TogetherExecution },
  ) {
    this.enabled();
    const known = await getDb()
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.sessionId, id));
    return withActors([actor, ...known.map((p) => p.userId)], async (tx) => {
      await assertActorActive(tx, actor);
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .for("update");
      const predicate = and(
        eq(participants.sessionId, id),
        eq(participants.userId, actor),
      );
      const [own] = await tx.select().from(participants).where(predicate);
      requireTogether(session && own, "NOT_FOUND", 404);
      requireTogether(
        session.state === "closed" ||
          session.collaborationRevoked ||
          own.removedFromRoster,
        "SHARING_ACTIVE",
        409,
      );
      requireTogether(
        own.frozenPlan && ["saved", "finished_empty"].includes(own.status),
        "INVALID_STATE",
        409,
      );
      return replayMutation(
        tx,
        actor,
        `completion:review:${id}`,
        key,
        body,
        async () => {
          requireTogether(
            own.ownRevision === body.expectedOwnRevision,
            "VERSION_CONFLICT",
            409,
          );
          const [job] = await tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.sessionId, id), eq(jobs.userId, actor)));
          const [finished] = await tx
            .select({ createdAt: events.createdAt })
            .from(events)
            .where(
              and(
                eq(events.sessionId, id),
                sql`${events.event}->>'type' = 'participant_finished'`,
                sql`${events.event}->>'userId' = ${actor}`,
              ),
            )
            .orderBy(asc(events.revision))
            .limit(1);
          const result = await this.save(tx, actor, id, {
            revision: own.ownRevision + 1,
            plan: own.frozenPlan!,
            execution: body.execution,
            definitions: own.exerciseDefinitions,
            startedAt: own.originalStartedAt ?? session.createdAt,
            completedAt: job?.completedAt ?? finished?.createdAt ?? new Date(),
            historyId: own.historyId,
            clientRecordId: job?.clientRecordId,
          });
          const [saved] = await tx
            .select({ definitions: results.exerciseDefinitions })
            .from(results)
            .where(ownerSession(actor, id));
          await tx
            .update(participants)
            .set({
              execution: body.execution,
              exerciseDefinitions: saved.definitions,
              ownRevision: result.reviewedRevision,
              historyId: result.historyId,
              status: result.status,
            })
            .where(predicate);
          return result;
        },
      );
    });
  }
}

/** Actor lock covers recompute AND watermark acknowledgement, including legacy workers. */
export async function processReviewedEffects(actor: string, id: string) {
  return withActors([actor], async (tx) => {
    const [result] = await tx
      .select()
      .from(results)
      .where(ownerSession(actor, id));
    requireTogether(result, "NOT_FOUND", 404);
    if (result.effectsDoneVersion === result.effectsVersion) return;
    await recomputeRecoveredEffects(
      actor,
      [result.completedAt, new Date()],
      tx,
    );
    await tx
      .update(results)
      .set({ effectsDoneVersion: result.effectsVersion })
      .where(ownerSession(actor, id));
  });
}
export async function pendingReviewedEffects() {
  return getDb()
    .select()
    .from(results)
    .where(lt(results.effectsDoneVersion, results.effectsVersion))
    .limit(50);
}
