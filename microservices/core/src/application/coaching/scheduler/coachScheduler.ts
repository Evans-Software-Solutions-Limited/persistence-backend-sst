import { and, eq, lt } from "drizzle-orm";
import { coachSchedulerRuns } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";

/**
 * `coachSchedulerCron` (PER-117, design C D2): every 15 minutes, a list of
 * bounded, idempotent jobs.
 *
 * Each job claims `(job, run_key)` in `coach_scheduler_runs` before it runs:
 * the 15-minute slot for `tick` jobs, the UTC date for `daily` ones. So the
 * same tick run twice (an EventBridge retry, a manual invoke) does nothing the
 * second time, and every job is ALSO idempotent on its own data (unique keys,
 * conditional updates), so even a job run twice changes nothing.
 *
 * A job that throws gives its claim back, so the next tick retries it, and the
 * other jobs still run. The cron then fails, so its error alarm fires.
 *
 * **Adding a job** (BE-E1b chat retries, BE-I2 session reminders): write a
 * `SchedulerJob` in `./jobs/` and add it to `COACH_SCHEDULER_JOBS` in
 * `./jobs/index.ts`. Nothing else changes.
 */

export interface SchedulerContext {
  now: Date;
  dispatcher: NotificationDispatcher;
}

export interface SchedulerJob {
  /** Stable: it is the claim key in `coach_scheduler_runs`. */
  name: string;
  /** `tick`: every run. `daily`: once a UTC day, from `DAILY_FROM_HOUR_UTC`. */
  cadence: "tick" | "daily";
  run(ctx: SchedulerContext): Promise<Record<string, number>>;
}

export const TICK_MINUTES = 15;
/** Daily jobs wait for the UK morning, so their pushes don't land at night. */
export const DAILY_FROM_HOUR_UTC = 8;
const RUN_RETENTION_DAYS = 30;

/** "2026-11-23T09:15" — the 15-minute slot an instant falls in. */
export function tickKey(now: Date): string {
  const slot = new Date(now);
  slot.setUTCSeconds(0, 0);
  slot.setUTCMinutes(
    Math.floor(slot.getUTCMinutes() / TICK_MINUTES) * TICK_MINUTES,
  );
  return slot.toISOString().slice(0, 16);
}

export function runKeyFor(job: SchedulerJob, now: Date): string | null {
  if (job.cadence === "tick") return tickKey(now);
  if (now.getUTCHours() < DAILY_FROM_HOUR_UTC) return null;
  return now.toISOString().slice(0, 10);
}

async function claim(job: string, runKey: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .insert(coachSchedulerRuns)
    .values({ job, runKey, ranAt: now })
    .onConflictDoNothing()
    .returning({ job: coachSchedulerRuns.job });
  return rows.length === 1;
}

async function release(job: string, runKey: string): Promise<void> {
  await getDb()
    .delete(coachSchedulerRuns)
    .where(
      and(
        eq(coachSchedulerRuns.job, job),
        eq(coachSchedulerRuns.runKey, runKey),
      ),
    );
}

export type JobOutcome =
  | { status: "ran"; summary: Record<string, number> }
  | { status: "skipped"; reason: "not_due" | "already_ran" }
  | { status: "failed"; error: string };

export interface SchedulerResult {
  tick: string;
  jobs: Record<string, JobOutcome>;
}

export async function runCoachScheduler(
  jobs: readonly SchedulerJob[],
  ctx: SchedulerContext,
): Promise<SchedulerResult> {
  const result: SchedulerResult = { tick: tickKey(ctx.now), jobs: {} };
  for (const job of jobs) {
    const runKey = runKeyFor(job, ctx.now);
    if (runKey === null) {
      result.jobs[job.name] = { status: "skipped", reason: "not_due" };
      continue;
    }
    if (!(await claim(job.name, runKey, ctx.now))) {
      result.jobs[job.name] = { status: "skipped", reason: "already_ran" };
      continue;
    }
    try {
      result.jobs[job.name] = { status: "ran", summary: await job.run(ctx) };
    } catch (err) {
      console.error(`[coach-scheduler] ${job.name} failed`, err);
      await release(job.name, runKey).catch(() => undefined);
      result.jobs[job.name] = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  await getDb()
    .delete(coachSchedulerRuns)
    .where(
      lt(
        coachSchedulerRuns.ranAt,
        new Date(ctx.now.getTime() - RUN_RETENTION_DAYS * 86_400_000),
      ),
    );
  return result;
}

/** The Lambda entry's default context. */
export function defaultContext(now: Date = new Date()): SchedulerContext {
  return { now, dispatcher: new NotificationDispatcher() };
}
