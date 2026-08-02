import type { AiJob } from "@persistence/db";
import { AiUsageLogRepository } from "../repositories/aiUsageLogRepository";
import {
  assertEntitlement,
  type EntitlementFeature,
  type EntitlementVerdict,
} from "../entitlement/assertEntitlement";
import { AiJobRepository } from "./aiJobRepository";
import { getJobKind } from "./registry";
import { sqsJobQueue, type JobQueue } from "./jobQueue";
import { JobKindError, JobTooLargeError } from "./types";

/**
 * Enqueue result — a discriminated union rather than a thrown error per case,
 * because every branch is a legitimate HTTP outcome the calling handler maps to
 * a status code. Throwing would push that mapping into `coreErrorHandler`,
 * away from the route that owns the contract.
 */
export type EnqueueResult =
  | { outcome: "accepted"; job: AiJob }
  | { outcome: "replayed"; job: AiJob }
  | { outcome: "unknown_kind" }
  /**
   * Carries the WHOLE deny verdict, not just the feature name. `assertEntitlement`
   * returns `reason` and an upgrade target, and `PREMIUM_PLUS_FEATURES` /
   * `pickUpgradeTier` exist precisely so a `loadout` deny upsells Premium+ rather
   * than Premium — "upselling Premium would take the user's money and still leave
   * the feature locked". Collapsing it to a feature name makes that
   * unreconstructable by the calling route, so the 402 body the mobile gate
   * renders would lose its upgrade target.
   */
  | {
      outcome: "not_entitled";
      feature: EntitlementFeature;
      verdict: EntitlementVerdict;
    }
  | { outcome: "rate_limited" }
  /** This user already has a job of this kind in flight (design § 5.1) → 409. */
  | { outcome: "in_flight" }
  | { outcome: "too_large"; total: number; limit: number }
  | { outcome: "input_invalid"; message: string }
  | { outcome: "queue_unavailable" };

/**
 * Read a kind's daily ceiling, fail-safe (#156 pattern, AC-4.3).
 *
 * A mis-set env var must never silently DISABLE the guard: garbage parses to
 * NaN and `""` parses to 0, and both fall back to the kind's default rather
 * than to "unlimited".
 */
export function resolveCeiling(envName: string, fallback: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The shared enqueue path — `specs/_shared/async-jobs/design.md` § 1, US-1.
 *
 * A feature route calls this; the spine does not own a URL (design § 6). There
 * is no generic `POST /jobs` because entitlement, sizing and input validation
 * are all kind-specific, and a generic endpoint would have to trust the caller
 * to name its own kind.
 *
 * ## Guard order — this IS the cost-safety contract
 *
 *   kind known → entitlement (402) → daily ceiling (429) → plan/size (413/400)
 *   → insert row → publish → 202
 *
 * Cloned from `aiEquipmentScanHandler`'s order deliberately. Every rejection is
 * free and writes no `ai_usage_log` row, so a rejected attempt burns no quota.
 * Entitlement precedes the ceiling so an unentitled caller cannot use 429-vs-402
 * to probe another user's usage; the ceiling precedes `plan()` so a capped
 * caller does not get free sizing work.
 */
export async function enqueueJob(input: {
  userId: string;
  kind: string;
  input: unknown;
  clientRequestId?: string | null;
  /** Injectable for tests; production uses the SQS adapter. */
  queue?: JobQueue;
  repository?: AiJobRepository;
  usageLog?: AiUsageLogRepository;
}): Promise<EnqueueResult> {
  const kind = getJobKind(input.kind);
  if (!kind) {
    return { outcome: "unknown_kind" };
  }

  const queue = input.queue ?? sqsJobQueue;
  const jobs = input.repository ?? new AiJobRepository();
  const usageLog = input.usageLog ?? new AiUsageLogRepository();

  const verdict = await assertEntitlement(input.userId, kind.feature);
  if (!verdict.allowed) {
    return { outcome: "not_entitled", feature: kind.feature, verdict };
  }

  // ⚠ Counted on `ceilingEndpoint` — ONE row per job — never on
  // `inferenceEndpoint`, which gets one row per model call inside the job
  // (AC-4.4, design § 5). With a single key a 120-inference job would trip its
  // own ceiling on the first run.
  //
  // ⚠ Best-effort, and knowingly so: the count is read before the row is
  // written, so a parallel burst all sees the same count and all proceeds.
  // That is the #156 pattern every AI endpoint in this repo shares, and making
  // this one transactional would leave it enforcing a different contract from
  // its siblings. The proper fix belongs in `AiUsageLogRepository` for all of
  // them at once (recorded in STATE.md § Open items). The exposure here is
  // smaller than on the sync endpoints in one respect and larger in another:
  // the worker's `reservedConcurrency` caps how many jobs actually RUN at once,
  // but each job is worth many inferences.
  const limit = resolveCeiling(kind.ceilingEnv, kind.ceilingDefault);
  const usedToday = await usageLog.countForUserToday(
    input.userId,
    kind.ceilingEndpoint,
  );
  if (usedToday >= limit) {
    return { outcome: "rate_limited" };
  }

  let total: number;
  try {
    ({ total } = await kind.plan(input.input as never, input.userId));
  } catch (error) {
    if (error instanceof JobTooLargeError) {
      // 413 rather than a silent truncation — spec-21 design § 7.3 is explicit
      // that a programme over the cap must be told to adapt in parts.
      return { outcome: "too_large", total: error.total, limit: error.limit };
    }
    if (error instanceof JobKindError && error.code === "input_invalid") {
      return { outcome: "input_invalid", message: error.message };
    }
    throw error;
  }

  const { job, outcome } = await jobs.enqueue({
    userId: input.userId,
    kind: input.kind,
    input: input.input,
    total,
    clientRequestId: input.clientRequestId ?? null,
  });

  // Serialised per user per kind by a unique index (design § 5.1) — the cost
  // control the read-then-write daily ceiling cannot be, since one unit of work
  // here is up to ~120 inferences.
  if (outcome === "in_flight" || job === null) {
    return { outcome: "in_flight" };
  }

  // A replay of an already-enqueued request. Do NOT re-publish: the original
  // message is either still on the queue or has already been consumed, and a
  // second message would be a duplicate delivery. The claim makes that safe,
  // but it would still burn a worker invocation for nothing.
  if (outcome === "replayed") {
    return { outcome: "replayed", job };
  }

  try {
    await queue.send({ jobId: job.id });
  } catch (error) {
    // ⚠ AC-1.2, and the row is DELETED rather than marked failed.
    //
    // Marking it failed looks tidier and was the first instinct, but it sets a
    // trap: the dead row keeps occupying both the idempotency key and the
    // in-flight slot. A client retrying with the SAME key — exactly what an
    // idempotency key is for, and exactly what a `retryable` error invites —
    // would then get `200 replayed` with the same dead job, permanently. Deleting
    // frees both, so the retry behaves like a first attempt.
    //
    // The delete is scoped to a never-claimed `queued` row, so it cannot race a
    // worker; and if it somehow does not land, the queued-stale reaper is the
    // backstop. Either way nothing returns `accepted` for work nothing will run.
    try {
      await jobs.deleteUnpublished(job.id);
    } catch (cleanupError) {
      console.error(
        `[ai-job] failed to clean up unpublished job=${job.id}: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
      );
    }
    console.error(
      `[ai-job] enqueue failed to publish job=${job.id} kind=${input.kind}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { outcome: "queue_unavailable" };
  }

  // The ceiling row is written only once the job is REAL — durable and
  // published. A job that never made it to the queue must not consume quota,
  // exactly as a pre-model rejection does not on the sync endpoints.
  try {
    await usageLog.record({
      userId: input.userId,
      endpoint: kind.ceilingEndpoint,
      requestSizeBytes: Buffer.byteLength(JSON.stringify(input.input)),
      responseSizeBytes: null,
      ms: null,
    });
  } catch (logError) {
    // Best-effort telemetry (cross-cuts § 4.2) — never fail an accepted job
    // because the usage-log insert failed.
    console.error(
      `[ai-usage-log] failed to record ${kind.ceilingEndpoint}: ${
        logError instanceof Error ? logError.message : String(logError)
      }`,
    );
  }

  return { outcome: "accepted", job };
}
