import type { JobKind } from "./types";

/**
 * The job-kind registry — `specs/_shared/async-jobs/design.md` § 4.
 *
 * ⚠ SHIPS EMPTY, deliberately. The spine is infrastructure; a kind belongs to
 * the feature that needs it:
 *
 *   - `loadout_programme_adapt` → spec-21 Loadout Phase 4 (T-J2.1)
 *   - `mealprint_week_plan`     → spec-26 Mealprint Phase 3 (T-J3.1)
 *   - program import            → ROADMAP § 5.3, parked
 *
 * Shipping a kind here would couple the spine to a feature that has not been
 * designed yet, which is the coupling this whole spec exists to avoid.
 */
const registry = new Map<string, JobKind<never, never, never>>();

/**
 * Register a kind. Called at module load from the consuming feature's index.
 *
 * The two guards below are enforced here rather than left to review because
 * both failures are SILENT at runtime: a duplicate kind would have one
 * implementation quietly shadow another, and equal endpoint keys would make a
 * multi-inference job trip its own daily ceiling on its first run (AC-4.4).
 * Throwing at module load turns either into a deploy-time crash instead.
 */
export function registerJobKind<TInput, TCheckpoint, TResult>(
  kind: JobKind<TInput, TCheckpoint, TResult>,
): void {
  if (registry.has(kind.kind)) {
    throw new Error(
      `[ai-job] duplicate job kind "${kind.kind}" — a kind may be registered once`,
    );
  }
  if (kind.ceilingEndpoint === kind.inferenceEndpoint) {
    throw new Error(
      `[ai-job] job kind "${kind.kind}" uses one endpoint key for both its ceiling ` +
        `and its per-inference telemetry. They must differ (design § 5): a job that ` +
        `writes N inference rows under its ceiling key trips its own ceiling.`,
    );
  }
  registry.set(kind.kind, kind as unknown as JobKind<never, never, never>);
}

/**
 * Look up a kind. `undefined` for an unregistered name, which the worker turns
 * into a terminal `unknown_kind` failure rather than a crash — the realistic
 * cause is deploy skew (a job enqueued by a newer API Lambda, picked up by an
 * older worker), and retrying that forever helps nobody.
 */
export function getJobKind(
  kind: string,
): JobKind<never, never, never> | undefined {
  return registry.get(kind);
}

/** Registered kind names. Exists for tests and diagnostics. */
export function registeredJobKinds(): string[] {
  return [...registry.keys()].sort();
}

/** Test-only. Never called in production code. */
export function __clearJobKindRegistry(): void {
  registry.clear();
}
