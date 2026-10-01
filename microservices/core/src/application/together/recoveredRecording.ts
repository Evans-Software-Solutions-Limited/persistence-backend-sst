import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  exerciseSets,
  sessionExercises,
  workoutSessions,
  personalRecords,
  userStreaks,
  userAchievements,
  achievements,
  type TogetherPlan,
  type TogetherExecution,
  type TogetherExerciseDefinition,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { requireTogether, lockActors, type TogetherTx } from "./shared";
import { materializeTogetherExercise } from "./exerciseRecording";
import { PersonalRecordsRepository } from "../repositories/personalRecordsRepository";
import { VolumeRepository } from "../repositories/volumeRepository";
import {
  FREEZE_TOKEN_CAP,
  PERIODS_PER_FREEZE_TOKEN,
} from "../streaks/milestones";
import { addDaysISO, localDateISO } from "../streaks/period";
import { weekStartISO } from "../progress/window";

export interface RecoveredHistoryInput {
  historyId: string | null;
  clientRecordId: string;
  plan: TogetherPlan;
  execution: TogetherExecution;
  /** Definitions already authorized and captured by the calling recovery transaction. */
  exerciseDefinitions: Record<string, TogetherExerciseDefinition>;
  startedAt: Date;
  completedAt: Date;
}

function stableId(...parts: string[]) {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const computedTypes = [
  "1rm",
  "3rm",
  "5rm",
  "10rm",
  "max_weight",
  "max_volume",
  "best_time",
  "longest_distance",
] as const;

/** Caller owns the reviewed revision, receipt and outbox in this same transaction. */
export async function writeRecoveredHistory(
  tx: TogetherTx,
  actor: string,
  input: RecoveredHistoryInput,
): Promise<string | null> {
  await lockActors(tx, [actor]);
  const [existing] = await tx
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, actor),
        input.historyId
          ? eq(workoutSessions.id, input.historyId)
          : eq(workoutSessions.clientSessionId, input.clientRecordId),
      ),
    )
    .for("update");
  requireTogether(!input.historyId || existing, "NOT_FOUND", 404);
  requireTogether(
    !existing || existing.clientSessionId === input.clientRecordId,
    "IDEMPOTENCY_MISMATCH",
    409,
  );
  const performed = input.plan.exercises.flatMap((plan) => {
    const execution = input.execution.exercises.find(
      (e) => e.planExerciseId === plan.planExerciseId,
    );
    const sets = execution?.sets.filter((s) => s.completed) ?? [];
    return execution && sets.length ? [{ plan, execution, sets }] : [];
  });
  if (!existing && !performed.length) return null;
  const completedAt = existing?.completedAt ?? input.completedAt;
  let historyId = existing?.id;
  if (!historyId) {
    const [created] = await tx
      .insert(workoutSessions)
      .values({
        userId: actor,
        clientSessionId: input.clientRecordId,
        name: input.plan.name,
        status: "completed",
        startedAt: input.startedAt,
        completedAt,
      })
      .returning({ id: workoutSessions.id });
    historyId = created.id;
  }
  const prior = await tx
    .select({ exerciseId: sessionExercises.exerciseId })
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, historyId));
  const touched = new Set(prior.map((e) => e.exerciseId));
  // Delete children explicitly so the operation also works against schema-derived test databases.
  const childIds = tx
    .select({ id: sessionExercises.id })
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, historyId));
  await tx
    .delete(exerciseSets)
    .where(inArray(exerciseSets.sessionExerciseId, childIds));
  await tx
    .delete(sessionExercises)
    .where(eq(sessionExercises.sessionId, historyId));
  for (const { plan, execution, sets } of performed) {
    const sourceId = execution.substituteExerciseId ?? plan.exerciseId;
    const definition = input.exerciseDefinitions[sourceId];
    const exerciseId = await materializeTogetherExercise(
      tx,
      actor,
      sourceId,
      definition,
    );
    const originalExerciseId = execution.substituteExerciseId
      ? await materializeTogetherExercise(
          tx,
          actor,
          plan.exerciseId,
          input.exerciseDefinitions[plan.exerciseId],
        )
      : null;
    touched.add(exerciseId);
    const sessionExerciseId = stableId(
      actor,
      input.clientRecordId,
      "exercise",
      plan.planExerciseId,
    );
    await tx.insert(sessionExercises).values({
      id: sessionExerciseId,
      sessionId: historyId,
      exerciseId,
      exerciseCategory: definition.category,
      sortOrder: plan.order,
      originalExerciseId,
      isSubstituted: !!execution.substituteExerciseId,
    });
    await tx.insert(exerciseSets).values(
      sets.map((set, i) => ({
        id: stableId(
          actor,
          input.clientRecordId,
          plan.planExerciseId,
          set.setId,
        ),
        sessionExerciseId,
        setNumber: i + 1,
        reps: set.reps,
        weightKg: String(set.weightKg),
        isCompleted: true,
        completedAt,
      })),
    );
  }
  await tx
    .update(workoutSessions)
    .set({
      status: performed.length ? "completed" : "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(workoutSessions.id, historyId));
  if (touched.size) {
    const ids = [...touched];
    await tx
      .delete(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, actor),
          inArray(personalRecords.exerciseId, ids),
          inArray(personalRecords.recordType, [...computedTypes]),
        ),
      );
    const ownExercises = tx
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .innerJoin(
        workoutSessions,
        eq(workoutSessions.id, sessionExercises.sessionId),
      )
      .where(
        and(
          eq(workoutSessions.userId, actor),
          inArray(sessionExercises.exerciseId, ids),
        ),
      );
    await tx
      .update(exerciseSets)
      .set({ isPersonalRecord: false })
      .where(inArray(exerciseSets.sessionExerciseId, ownExercises));
    const historical = await tx
      .selectDistinct({
        id: workoutSessions.id,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .innerJoin(
        sessionExercises,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(workoutSessions.userId, actor),
          eq(workoutSessions.status, "completed"),
          inArray(sessionExercises.exerciseId, ids),
        ),
      )
      .orderBy(asc(workoutSessions.completedAt), asc(workoutSessions.id));
    const repository = new PersonalRecordsRepository();
    for (const session of historical)
      await repository.recordPRsForSession(actor, session.id, tx);
    // The legacy detector stamps detection time; recovery preserves the winning workout's date.
    await tx.execute(sql`UPDATE ${personalRecords} AS pr SET achieved_at = ws.completed_at
      FROM ${exerciseSets} AS es JOIN ${sessionExercises} AS se ON se.id = es.session_exercise_id
      JOIN ${workoutSessions} AS ws ON ws.id = se.session_id
      WHERE pr.user_id = ${actor} AND pr.exercise_id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      AND pr.set_id = es.id AND ws.user_id = ${actor} AND ws.completed_at IS NOT NULL`);
  }
  return historyId;
}

/** Durable job caller must acknowledge only the effects generation it processed. */
export async function recomputeRecoveredEffects(
  actor: string,
  dates: Date[],
  transaction?: TogetherTx,
): Promise<void> {
  const repo = new VolumeRepository(transaction);
  const tz = await repo.getUserTimezone(actor);
  await rebuildRecoveredWorkoutStreak(actor, tz, transaction);
  const now = new Date();
  const today = localDateISO(now, tz);
  const weeks = new Set<string>();
  const months = new Set<string>();
  for (const date of [...dates, now]) {
    weeks.add(weekStartISO(date, tz));
    months.add(localDateISO(date, tz).slice(0, 7) + "-01");
  }
  for (const week of weeks)
    await repo.recomputeWeeklyVolume(actor, tz, week, addDaysISO(week, 6));
  for (const month of months) {
    const end = new Date(`${month}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const last = end.toISOString().slice(0, 10);
    await repo.recomputeVolumeByMuscle(
      actor,
      tz,
      "month",
      month,
      last < today ? last : today,
    );
  }
}

/** Replacement, not monotonic advancement. Previously earned achievements remain earned. */
async function rebuildRecoveredWorkoutStreak(
  actor: string,
  tz: string,
  transaction?: TogetherTx,
) {
  const rebuild = async (tx: TogetherTx) => {
    await tx
      .delete(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, actor),
          eq(userStreaks.streakType, "workout_streak"),
          sql`${userStreaks.sourceGoalId} IS NULL`,
          sql`NOT EXISTS (SELECT 1 FROM ${workoutSessions} WHERE ${workoutSessions.userId} = ${actor} AND ${workoutSessions.status} = 'completed' AND ${workoutSessions.completedAt} <= now())`,
        ),
      );
    await tx.execute(sql`
      WITH RECURSIVE workout_weeks AS MATERIALIZED (
        SELECT date_trunc('week', ${workoutSessions.completedAt} AT TIME ZONE ${tz})::date AS week_start
        FROM ${workoutSessions}
        WHERE ${workoutSessions.userId} = ${actor}
          AND ${workoutSessions.status} = 'completed'
          AND ${workoutSessions.completedAt} IS NOT NULL
          AND ${workoutSessions.completedAt} <= now()
          
        GROUP BY 1
      ), ordered_weeks AS (
        SELECT week_start, row_number() OVER (ORDER BY week_start)::int AS rn
        FROM workout_weeks
      ), replay AS (
        SELECT
          ow.rn,
          ow.week_start,
          1::int AS current_count,
          1::int AS longest_count,
          0::int AS freeze_tokens
        FROM ordered_weeks ow
        WHERE ow.rn = 1

        UNION ALL

        SELECT
          ow.rn,
          ow.week_start,
          step.new_count,
          greatest(r.longest_count, step.new_count)::int,
          least(
            ${FREEZE_TOKEN_CAP},
            step.tokens_after_gap + CASE
              WHEN step.new_count % ${PERIODS_PER_FREEZE_TOKEN} = 0 THEN 1
              ELSE 0
            END
          )::int
        FROM replay r
        JOIN ordered_weeks ow ON ow.rn = r.rn + 1
        CROSS JOIN LATERAL (
          SELECT greatest(((ow.week_start - r.week_start) / 7) - 1, 0)::int AS missed
        ) gap
        CROSS JOIN LATERAL (
          SELECT
            CASE
              WHEN r.freeze_tokens >= gap.missed THEN r.current_count + 1
              ELSE 1
            END::int AS new_count,
            CASE
              WHEN r.freeze_tokens >= gap.missed THEN r.freeze_tokens - gap.missed
              ELSE r.freeze_tokens
            END::int AS tokens_after_gap
        ) step
      ), replayed AS (
        SELECT rn, week_start, current_count, longest_count, freeze_tokens
        FROM replay
        ORDER BY rn DESC
        LIMIT 1
      ), summary AS (
        SELECT
          r.week_start AS latest_week,
          r.longest_count,
          CASE
            WHEN r.freeze_tokens >= terminal.missed THEN r.current_count
            ELSE 0
          END::int AS current_count,
          CASE
            WHEN r.freeze_tokens >= terminal.missed THEN r.freeze_tokens - terminal.missed
            ELSE r.freeze_tokens
          END::int AS freeze_tokens,
          CASE
            WHEN r.freeze_tokens >= terminal.missed THEN 'active'
            ELSE 'broken'
          END AS status,
          CASE
            WHEN terminal.missed > 0
              THEN date_trunc('week', now() AT TIME ZONE ${tz})::date - 1
            ELSE r.week_start + 6
          END AS last_period_end
        FROM replayed r
        CROSS JOIN LATERAL (
          SELECT greatest(
            ((date_trunc('week', now() AT TIME ZONE ${tz})::date - r.week_start) / 7) - 1,
            0
          )::int AS missed
        ) terminal
      ), repaired_streak AS (
        INSERT INTO ${userStreaks} (
          user_id, streak_type, source_goal_id, period, current_count,
          longest_count, last_period_end, freeze_tokens, status
        )
        SELECT
          ${actor}, 'workout_streak', NULL, 'weekly',
          s.current_count,
          s.longest_count,
          s.last_period_end,
          s.freeze_tokens,
          s.status
        FROM summary s
        WHERE s.latest_week IS NOT NULL
        ON CONFLICT (user_id)
          WHERE streak_type = 'workout_streak' AND source_goal_id IS NULL
        DO UPDATE SET
          current_count = EXCLUDED.current_count,
          longest_count = EXCLUDED.longest_count,
          last_period_end = EXCLUDED.last_period_end,
          freeze_tokens = EXCLUDED.freeze_tokens,
          status = EXCLUDED.status,
          updated_at = now()
        RETURNING longest_count
      ), attainable AS (
        SELECT longest_count FROM repaired_streak LIMIT 1
      )
      INSERT INTO ${userAchievements} (user_id, achievement_id)
      SELECT ${actor}, ${achievements.id}
      FROM ${achievements}
      CROSS JOIN attainable a
      WHERE ${achievements.category} = 'streak'
        AND ${achievements.requirements}->>'streak_type' = 'workout_streak'
        AND (${achievements.requirements}->>'threshold')::int <= a.longest_count
      ON CONFLICT DO NOTHING
    `);
  };
  if (transaction) await rebuild(transaction);
  else await getDb().transaction(rebuild);
}
