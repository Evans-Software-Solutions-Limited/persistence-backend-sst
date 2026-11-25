import type { SchedulerJob } from "../coachScheduler";
import { coachPushesJob } from "./coachPushes";
import { chatChannelsJob } from "./chatChannels";
import {
  inviteExpiryJob,
  programmeEndingJob,
  trainingBehindJob,
} from "./coachChecks";
import { formPeriodsJob } from "./formPeriods";
import { formPushesJob, missedFormsJob } from "./formRequests";

/**
 * Every job `coachSchedulerCron` runs, in order (PER-117, design C D2).
 *
 * Forms first: periods (which also mark the previous period missed), then
 * overdue requests, then the athlete's pushes. The coach checks next. Coach
 * pushes last, so held pushes are released and anything left `pending` this
 * tick goes out in the same run.
 *
 * To add a job (BE-E1b chat retries, BE-I2 session reminders): import it and
 * add it here, before `coachPushesJob` if it writes coach events.
 */
export const COACH_SCHEDULER_JOBS: readonly SchedulerJob[] = [
  formPeriodsJob,
  missedFormsJob,
  formPushesJob,
  inviteExpiryJob,
  programmeEndingJob,
  trainingBehindJob,
  coachPushesJob,
  // PER-120 (design E): chat channel provisioning and freeze retries. Writes
  // no coach events, so it runs after coachPushesJob.
  chatChannelsJob,
];
