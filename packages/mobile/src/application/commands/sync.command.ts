import type { AuthPort } from "@/domain/ports/auth.port";
import type {
  RecordResponseSummary,
  RecordResponseSummaryPR,
  StoragePort,
  SyncQueueEntry,
} from "@/domain/ports/storage.port";
import type { EntitlementVerdict } from "@/domain/ports/sync.types";
import type { HabitConfigEntry } from "@/domain/ports/api.port";
import { habitConfigFromEntry } from "@/domain/models/habit-config";
import { normalizePreferences } from "@/domain/models/notification-preferences";
import { pendingPreferenceOverrides } from "@/application/notifications/queries/preferences.query";
import { parseEntitlementDeniedResponseText } from "@/shared/errors/parseEntitlement";
import { resolveExercisePayloadReferences } from "@/application/commands/resolveExerciseReferences";
import { captureSyncFailure } from "@/lib/sentry";

/** A non-OK HTTP response from a sync POST/PUT/DELETE, carrying the status so
 * the drain can classify permanent vs transient failures. */
class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

/**
 * A permanent client error the drain must NOT retry: a 4xx that a re-send of
 * the identical request can never turn into a 2xx (malformed body, missing
 * ref, gone, conflict). Excluded (i.e. kept RETRYABLE):
 * - 401 Unauthorized — the token is refreshed per-entry; a session-refresh
 *   race right after reconnect (exactly when a batch drains) can send a
 *   stale/absent token, and a retry with a fresh one succeeds. Marking it
 *   permanent would strand every entry behind a momentary auth blip.
 * - 403 Forbidden — can be transient in this app: a coach action queued while
 *   role/subscription state is diverged (the coach-mode 403 trap) succeeds once
 *   the entitlement trigger re-syncs.
 * - 408 Request Timeout / 429 Too Many Requests — explicitly retry-worthy.
 * - 402 — handled earlier as `blocked_entitlement`; a malformed 402 body
 *   deliberately falls through to the transient path (never fabricate a verdict).
 */
function isPermanentClientError(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 402 &&
    status !== 403 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * Does this payload still reference a dependency's `local-…` id (a recipe/
 * meal/food/workout created offline-first that hasn't synced yet)? Such a
 * reference resolves when the dependency's create flushes and its
 * `swapLocal*Id` rewrites the STORED payload — but this drain already
 * snapshotted the stale payload via `getPendingMutations()`, so the send in
 * THIS pass still carries the local id and 4xxs (e.g. `recipe_not_found`).
 * That failure is DEFERRED, not permanent: the next drain re-reads the
 * now-swapped row and succeeds. So a 4xx here must stay retryable rather than
 * become `permanently_failed` (which would strand it before the retry).
 */
function referencesUnsyncedLocalId(payload: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(payload) as unknown;
  } catch {
    return false;
  }
  return containsLocalId(body, 0);
}

/**
 * Maximum object depth walked by `containsLocalId`.
 *
 * The deepest real payload is a workout create — `{ exercises: [ { … } ] }`, i.e.
 * depth 3 — so 6 is generous while still bounding a pathological or hostile
 * structure. Sync payloads are locally authored, but a payload can carry
 * server-echoed content and this runs on every failed entry.
 */
const LOCAL_ID_SCAN_MAX_DEPTH = 6;

/**
 * Does any string ANYWHERE in this payload look like an unsynced local id?
 *
 * Deliberately a full recursive walk rather than a list of known keys. The
 * previous version checked four TOP-LEVEL scalar keys
 * (`recipeId`/`mealId`/`foodId`/`workoutId`) and so never looked at
 * `exercises[].exerciseId` — which is precisely where a `local-…` id lives when a
 * user adds a just-created custom exercise to a workout. The resulting 400 was
 * therefore classified PERMANENT on the first attempt and the workout was lost,
 * even though the reference would have resolved once the exercise create flushed.
 *
 * Any new nested reference is covered automatically; a key allowlist would have
 * to be remembered, and forgetting it is silent.
 */
function containsLocalId(value: unknown, depth: number): boolean {
  if (depth > LOCAL_ID_SCAN_MAX_DEPTH) return false;
  if (typeof value === "string") return value.startsWith("local-");
  if (Array.isArray(value)) {
    return value.some((item) => containsLocalId(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsLocalId(item, depth + 1),
    );
  }
  return false;
}

/**
 * Does the ENDPOINT still address an unsynced local id?
 *
 * `update-workout` and `delete-workout` interpolate the id into the path
 * (`/workouts/local-…`), and a DELETE carries no payload at all, so the
 * payload-only check above could never see it. Such a request 400s with
 * "Invalid identifier format" (Postgres 22P02 on the uuid column) and — being a
 * 4xx — was marked permanent, stranding the edit or delete forever. It resolves
 * as soon as the create flushes and `swapLocalWorkoutId` rewrites the endpoint.
 */
function endpointReferencesUnsyncedLocalId(endpoint: string): boolean {
  return endpoint.split(/[/?&=]/).some((part) => part.startsWith("local-"));
}

/**
 * Translate an `/exercises` payload's domain enum references into catalogue
 * UUIDs. Returns the serialized body to send, or a reason to defer.
 *
 * A malformed stored payload (not JSON, or not an object) is passed through
 * untouched: the drain's job is not to validate history, and the server's own
 * rejection is the right place for that to surface.
 */
function prepareExercisePayload(
  storage: StoragePort,
  payload: string,
): { body: string; deferReason: null } | { body: null; deferReason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { body: payload, deferReason: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { body: payload, deferReason: null };
  }

  const resolution = resolveExercisePayloadReferences(
    storage,
    parsed as Record<string, unknown>,
  );
  switch (resolution.status) {
    case "unchanged":
      return { body: payload, deferReason: null };
    case "resolved":
      return { body: JSON.stringify(resolution.payload), deferReason: null };
    case "catalogue_unavailable":
      return {
        body: null,
        deferReason: `Waiting for the ${resolution.kinds.join(" + ")} reference list before sending; will retry.`,
      };
    case "unresolvable":
      // Loud, and it names the offending members so the mapping table can be
      // fixed. Deferring (rather than sending a silently-shortened array) is
      // deliberate: a partial send would create the exercise with its muscles
      // or equipment quietly missing.
      return {
        body: null,
        deferReason: `No catalogue entry for: ${resolution.unresolved.join(", ")}. Exercise not sent.`,
      };
  }
}

/**
 * How many times an entry may be POSTPONED without consuming its retry budget
 * before the drain starts charging the budget again.
 *
 * Deferral exists because a transport failure or a missing reference catalogue is
 * not the server rejecting the request — no attempt was made in the sense the
 * budget measures — and charging it meant ~25 seconds offline could exhaust an
 * entry and strand real user data.
 *
 * But budget-free must not mean consequence-free. A deferred entry is invisible to
 * every sync surface: `getFailedExhaustedEntries` gates on
 * `retryCount >= maxRetries`, and that query is the sole source for both the
 * sync-failed banner and the review screen. Deferring forever therefore means a
 * mutation that can NEVER succeed — a permanently unreachable host, a catalogue
 * entry that will never exist, a bug in the request builder — retries silently for
 * the life of the install with no banner, no review row, and no way for the user to
 * discard it. That is a worse failure than the one deferral fixed.
 *
 * Past this ceiling the drain falls back to `markMutationFailed`, so the entry
 * exhausts, surfaces in /sync-failed, and becomes user-retryable (a Retry resets
 * the counter, giving it the full free run again). At a ≥5s window per deferral the
 * ceiling is at least a minute of continuous failure, and in practice many app
 * foregrounds — far beyond the blip this protects against.
 */
export const MAX_TRANSPORT_DEFERRALS = 12;

/**
 * Postpone this entry without charging its retry budget — unless it has already
 * used up its free postponements, in which case charge the budget so it can
 * eventually exhaust and become visible. See `MAX_TRANSPORT_DEFERRALS`.
 *
 * `deferCount` is read from the caller's snapshot, i.e. the pre-update value, so
 * the Nth call is the one that escalates.
 */
function deferOrCharge(
  storage: StoragePort,
  entry: SyncQueueEntry,
  reason: string,
): void {
  if (entry.deferCount >= MAX_TRANSPORT_DEFERRALS) {
    storage.markMutationFailed(entry.id, reason);
    return;
  }
  storage.markMutationDeferred(entry.id, reason);
}

/**
 * Is this entry eligible to be sent right now?
 *
 * `getPendingMutations` returns everything still RETRYABLE — the question the
 * status UI and the coalescing paths ask. Backoff is a different question ("not
 * yet"), so it is applied here, at the point of sending, rather than by hiding
 * rows from the queue read.
 *
 * A malformed or unparseable `nextAttemptAt` is treated as DUE. Refusing to send
 * because a timestamp could not be parsed would strand the mutation, which is a
 * far worse outcome than one early retry.
 *
 * Exported so the worker's loop can use the same predicate it drains by — if the
 * two disagreed, the loop would spin on an entry the drain always skips.
 */
export function isMutationDue(
  entry: Pick<SyncQueueEntry, "nextAttemptAt">,
  now: number = Date.now(),
): boolean {
  if (entry.nextAttemptAt === null) return true;
  // SQLite's `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone
  // marker, which `Date.parse` reads as LOCAL time — hours out in either
  // direction. Normalise to ISO-with-Z before parsing.
  const normalized = entry.nextAttemptAt.includes("T")
    ? entry.nextAttemptAt
    : `${entry.nextAttemptAt.replace(" ", "T")}Z`;
  const dueAt = Date.parse(normalized);
  if (Number.isNaN(dueAt)) return true;
  return dueAt <= now;
}

export type SyncResult = {
  processed: number;
  succeeded: number;
  failed: number;
  /**
   * M10.6: entries the server rejected with HTTP 402 +
   * `code: "ENTITLEMENT_DENIED"`. Captured separately from `failed`
   * because the entry got a definitive server verdict (not a transient
   * error) — it's now waiting on a tier upgrade or an explicit user
   * action, not on a retry. The invariant
   * `processed === succeeded + failed + blocked` holds.
   */
  blocked: number;
};

/**
 * Server response shape returned by `POST /sessions/record` —
 * `data: {…session, personalRecords, workoutsThisMonth}`. Only the
 * augmented fields (Phase 3b) are read here; the rest of the payload
 * is the canonical session re-fetch which the swap path already
 * consumes elsewhere.
 *
 * Spec: microservices/core/src/application/repositories/sessionRepository.ts
 *       (RecordedSession + DetectedPersonalRecord).
 */
type RecordSessionApiResponse = {
  data: {
    id: string;
    personalRecords: RecordResponseSummaryPR[];
    // Nullable on the wire even though the backend always emits it
    // today — if a deploy skew or partial rollback drops the field,
    // we want to fall through to the em-dash fallback rather than
    // fabricate a "0 workouts this month" stat tile after the user
    // just completed a workout (Inspector Brad PR #62 medium-
    // severity).
    workoutsThisMonth?: number | null;
  };
};

/**
 * Process the sync queue: send pending mutations to the SST API.
 *
 * Entries are processed in FIFO order. Each entry is marked in-flight,
 * sent, then marked completed or failed. Failed entries are retried
 * up to their max_retries limit.
 *
 * The auth token is refreshed per-entry to avoid mass 401 failures
 * when the token expires mid-queue (realistic after long offline periods).
 *
 * Call this when:
 * - Network connectivity is restored
 * - App comes to foreground
 * - After a local mutation is enqueued (debounced)
 */
export async function processSyncQueue(
  storage: StoragePort,
  auth: AuthPort,
  apiBaseUrl: string,
  /**
   * Clock seam for the backoff check. Injected only by tests, which need to
   * assert "this entry is retried once its window opens" without sleeping.
   * Production always uses the real clock.
   */
  opts?: { now?: () => number },
): Promise<SyncResult> {
  const now = opts?.now ?? Date.now;
  const entries = storage.getPendingMutations();
  let succeeded = 0;
  let failed = 0;
  let blocked = 0;

  for (const entry of entries) {
    // Backoff: skip an entry whose retry window hasn't opened. Checked BEFORE
    // the claim so a not-yet-due entry stays `failed` (visible to the status UI
    // and to the coalescing paths) rather than being flipped to `in_flight` and
    // released again.
    if (!isMutationDue(entry, now())) continue;

    // Atomic claim — `markMutationInFlight` is row-conditional at the
    // storage layer (only flips status when currently
    // pending/failed). Returns false when another concurrent drain
    // already claimed this entry, in which case we silently skip it.
    // This is the guard against duplicate POSTs when two drains
    // race for the same queue (e.g. `useSyncWorker`'s on-mount /
    // AppState→active flush running concurrently with the inline
    // post-Submit drain in `WorkoutRatingContainer`). Inspector
    // Brad PR #62 race fix.
    const claimed = storage.markMutationInFlight(entry.id);
    if (!claimed) continue;

    try {
      // Fetch token per-entry to handle expiry mid-queue
      const token = await auth.getAccessToken();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      // Safe retries. An ambiguous failure — a timeout or connection reset that
      // happened AFTER the server committed — used to duplicate the row on the
      // next attempt, because only `POST /sessions/record` had an idempotency
      // key (`clientSessionId`); workout, exercise and nutrition creates had
      // none. The key is stamped once at enqueue, so every attempt at the same
      // logical mutation presents the same value.
      //
      // Omitted for rows enqueued before the column existed, which preserves
      // exactly the previous behaviour for them rather than inventing a key that
      // would differ per attempt (and so guarantee a duplicate).
      if (entry.idempotencyKey !== null) {
        headers["Idempotency-Key"] = entry.idempotencyKey;
      }

      // Per-entity payload preparation, immediately before the send.
      //
      // The drain's default is to flush the stored payload VERBATIM, and that
      // stays the rule — this is the one narrow, explicit exception. An
      // `/exercises` body carries muscle-group and equipment references as
      // domain enum members (`"chest"`, `"barbell"`), because that is what the
      // form produces and what the local cache stores, while the API validates
      // them as catalogue UUIDs. Translating here rather than at enqueue time
      // lets the payload wait for the reference catalogue (fetched lazily by
      // whichever screen needs it) instead of being frozen wrong.
      let body = entry.payload;
      if (entry.entityType === "exercise" && entry.method !== "DELETE") {
        const prepared = prepareExercisePayload(storage, entry.payload);
        if (prepared.deferReason !== null) {
          // Nothing was sent, so this must NOT consume the retry budget — the
          // resolution's own docstring calls a missing catalogue "not a transient
          // condition", and charging a transient budget for it exhausted the entry
          // after ~25s of drains and stranded the user's exercise where only
          // `/sessions/record` gets auto-resurrected. `markMutationDeferred`
          // postpones with a backoff window and leaves `retry_count` alone.
          //
          // Bounded, though — see `MAX_TRANSPORT_DEFERRALS`. An `unresolvable`
          // reference in particular may never become resolvable (a catalogue entry
          // that simply doesn't exist), and deferring that forever would keep the
          // exercise invisible in the queue instead of surfacing it where the user
          // can see the named members and discard or retry it.
          deferOrCharge(storage, entry, prepared.deferReason);
          failed++;
          continue;
        }
        body = prepared.body;
      }

      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers,
        body: entry.method !== "DELETE" ? body : undefined,
      });

      if (!response.ok) {
        const body = await response.text();
        // M10.6: classify HTTP 402 + structured ENTITLEMENT_DENIED body
        // as a `blocked_entitlement` outcome — distinct from a transient
        // failure. The user's current plan doesn't cover this mutation;
        // retrying won't help until they upgrade. Capture the verdict
        // on the entry so the review screen + auto-retry hook can act
        // on it, then CONTINUE the drain (one blocked entry never
        // aborts the flush — that's the offline-batch-of-50 scenario
        // the milestone was written for).
        //
        // Malformed 402 bodies fall through to the generic `failed`
        // path on purpose — we never fabricate a verdict from a partial
        // parse (Inspector Brad pattern: trust nothing the server
        // didn't explicitly send).
        if (response.status === 402) {
          const verdict = parseEntitlementBlockedVerdict(body);
          if (verdict !== null) {
            storage.markMutationBlocked(entry.id, verdict);
            blocked++;
            continue;
          }
        }
        throw new SyncHttpError(
          response.status,
          `HTTP ${response.status}: ${body}`,
        );
      }

      // M3 Phase 3b: capture the `/sessions/record` augmented response
      // so the Summary screen can swap its local prediction for
      // server-truth (PRs with previousValue + workoutsThisMonth).
      // Single-active-session invariant means the cache is keyed by
      // userId; cleared by `clearActiveSession` when the user taps
      // Continue. Other endpoints are unaffected — their bodies are
      // still discarded.
      //
      // Any parse failure is non-fatal: the mutation already succeeded
      // server-side, the Summary screen falls back to its local
      // prediction, and the queue entry still marks completed.
      // Logging + best-effort capture matches the brief's "trust but
      // verify" pattern for offline-first sync paths.
      if (
        entry.entityType === "session" &&
        entry.endpoint === "/sessions/record"
      ) {
        try {
          const body = (await response.json()) as RecordSessionApiResponse;
          const session = await auth.getSession();
          if (session.ok && session.value && body.data) {
            const summary: RecordResponseSummary = {
              localSessionId: entry.entityId ?? body.data.id,
              personalRecords: body.data.personalRecords ?? [],
              // `??` to `null`, NOT `0` — preserves the
              // "didn't get a real count" → em-dash fallback when the
              // field is missing/null on the wire. Cache slot stays
              // honest so the Summary screen can distinguish "server
              // said zero" (impossible — the session that just
              // finished IS a workout) from "server didn't tell us".
              workoutsThisMonth: body.data.workoutsThisMonth ?? null,
              cachedAt: new Date().toISOString(),
            };
            storage.cacheRecordResponse(session.value.userId, summary);
          }
        } catch (err) {
          // Body wasn't valid JSON, response.json() rejected, or
          // auth.getSession() rejected. Either way: the POST succeeded
          // (we passed `response.ok` above) so the queue entry should
          // still mark completed and the Summary screen falls back to
          // its local prediction. Swallow with a log so debugging is
          // possible without breaking the sync flow.
          console.warn(
            "[sync] /sessions/record succeeded but response capture failed; Summary will use local prediction:",
            err,
          );
        }
      }

      // Custom-exercise create: the POST returns the server-assigned id, but
      // the cached row + any queued follow-up edits still address the
      // optimistic `local-…` id. Swap it through so a later PATCH/DELETE hits
      // the real resource instead of 404ing forever (and so the next library
      // refresh doesn't duplicate the row under its real id). Non-fatal on
      // parse failure: the create already succeeded, so the entry still marks
      // completed — worst case the local id lingers until the next full
      // refresh reconciles it, exactly as before this fix. Mirrors the
      // `swapLocalSessionId` reply-path swap for sessions.
      if (
        entry.entityType === "exercise" &&
        entry.operation === "create" &&
        entry.entityId !== null
      ) {
        try {
          const body = (await response.json()) as { data?: { id?: string } };
          const serverId = body.data?.id;
          if (serverId && serverId !== entry.entityId) {
            storage.swapLocalExerciseId(entry.entityId, serverId);
          }
        } catch (err) {
          console.warn(
            "[sync] POST /exercises succeeded but id-swap failed; local id will reconcile on the next refresh:",
            err,
          );
        }
      }

      // Nutrition-entry create: the optimistic entry (and any DELETE/PUT a fast
      // swipe-delete/edit enqueued while this POST was in flight) still address
      // the `local-…` id. Swap it to the server id so that follow-up mutation
      // hits the real row instead of 404-looping — and so a delete after this
      // point can't orphan a server row. Mirrors the exercise swap above.
      if (
        entry.entityType === "nutrition_entry" &&
        entry.operation === "create" &&
        entry.entityId !== null
      ) {
        try {
          const body = (await response.json()) as { data?: { id?: string } };
          const serverId = body.data?.id;
          if (serverId && serverId !== entry.entityId) {
            storage.swapLocalNutritionEntryId(entry.entityId, serverId);
          }
        } catch (err) {
          console.warn(
            "[sync] POST /nutrition/entries succeeded but id-swap failed; local id will reconcile on the next refresh:",
            err,
          );
        }
      }

      // Workout create: the optimistic workout (and, crucially, any queued
      // `POST /sessions/record` whose serialized payload captured this
      // workout's `local-…` id at session-finish, plus any follow-up
      // PATCH/DELETE) still address the local id. Swap it to the server id so
      // the session record hits the real workout uuid instead of erroring with
      // `invalid input syntax for type uuid` forever (a permanent 500 retry
      // loop the user can only escape by discarding the completed session).
      // Mirrors the exercise/nutrition swaps above.
      if (
        entry.entityType === "workout" &&
        entry.operation === "create" &&
        entry.entityId !== null
      ) {
        try {
          const body = (await response.json()) as { data?: { id?: string } };
          const serverId = body.data?.id;
          if (serverId && serverId !== entry.entityId) {
            storage.swapLocalWorkoutId(entry.entityId, serverId);
          }
        } catch (err) {
          console.warn(
            "[sync] POST /workouts succeeded but id-swap failed; a session started against this workout may stay stuck until the next full refresh:",
            err,
          );
        }
      }

      // Recipe / meal create: a queued `POST /nutrition/entries` may have
      // frozen this recipe's/meal's `local-…` id as its `recipeId`/`mealId`
      // (user created it, then logged it before the create round-tripped). Swap
      // the local id to the server id so that log hits the real row instead of
      // 404ing (`recipe_not_found`/`meal_not_found`) → `permanently_failed`.
      // Mirrors the workout→session-payload swap above.
      if (
        entry.entityType === "recipe" &&
        entry.operation === "create" &&
        entry.entityId !== null
      ) {
        try {
          const body = (await response.json()) as { data?: { id?: string } };
          const serverId = body.data?.id;
          if (serverId && serverId !== entry.entityId) {
            storage.swapLocalRecipeId(entry.entityId, serverId);
          }
        } catch (err) {
          console.warn(
            "[sync] POST /recipes succeeded but id-swap failed; a log created against this recipe may stay stuck until the next full refresh:",
            err,
          );
        }
      }

      if (
        entry.entityType === "meal" &&
        entry.operation === "create" &&
        entry.entityId !== null
      ) {
        try {
          const body = (await response.json()) as { data?: { id?: string } };
          const serverId = body.data?.id;
          if (serverId && serverId !== entry.entityId) {
            storage.swapLocalMealId(entry.entityId, serverId);
          }
        } catch (err) {
          console.warn(
            "[sync] POST /meals succeeded but id-swap failed; a log created against this meal may stay stuck until the next full refresh:",
            err,
          );
        }
      }

      // 09: a flushed `POST /notifications/preferences` echoes the
      // server's authoritative merged JSONB column (RETURNING). Reset the
      // local cache to it so an optimistic toggle that raced a concurrent
      // change converges on server-truth. Non-fatal on parse failure: the
      // POST already succeeded, so the entry still marks completed and the
      // cache keeps its optimistic value until the next preferences read.
      if (
        entry.entityType === "notification-preferences" &&
        entry.endpoint === "/notifications/preferences"
      ) {
        try {
          const body = (await response.json()) as {
            data?: Record<string, unknown>;
          };
          if (body.data) {
            // Re-apply toggles still queued behind this one (this entry is
            // already in_flight, so it's excluded) so a concurrent toggle
            // isn't clobbered by this response's merged column.
            storage.cacheNotificationPreferences({
              ...normalizePreferences(body.data),
              ...pendingPreferenceOverrides(storage),
            });
          }
        } catch (err) {
          console.warn(
            "[sync] POST /notifications/preferences succeeded but response capture failed; cache keeps its optimistic value:",
            err,
          );
        }
      }

      // 18-habit-setup: a flushed SELF `habit_config` PUT echoes the server's
      // authoritative config (with the real goalId). Re-map it into the config
      // cache so an offline first-enable's optimistic `local-…` goalId is
      // swapped for the server id — the cache is keyed on category, so this
      // de-dupes the grid row (STORY-009 AC 9.3) without a full refresh. The
      // entityId is `${userId}:${category}` (a coach write is `${clientId}:…`,
      // skipped — the coach device doesn't cache the client's config). Non-fatal
      // on parse failure: the PUT already succeeded, so the local id lingers
      // until the next full config refresh reconciles it.
      //
      // Residual fix: if the user tapped that habit's grid cell BEFORE this
      // drain (offline-first — configureHabitCommand and toggleHabitDayCommand
      // both enqueue independently), a `/habit-completions` mutation is queued
      // against the OLD `local-…` goalId — and `cached_habit_completions` may
      // already have a row under it too. Capture the pre-write local goalId
      // and swap it (mirrors `swapLocalSessionId`/`swapLocalExerciseId`) BEFORE
      // overwriting the config cache, so a completion tapped offline doesn't
      // 404 (`goalBelongsToUser` false) and get silently dropped after retries
      // exhaust.
      if (
        entry.entityType === "habit_config" &&
        entry.operation === "update" &&
        entry.endpoint.startsWith("/users/me/habits/") &&
        entry.entityId
      ) {
        try {
          const selfUserId = entry.entityId.split(":")[0];
          const category = entry.entityId.split(":")[1];
          const body = (await response.json()) as {
            data?: HabitConfigEntry;
          };
          if (body.data && selfUserId) {
            const mapped = habitConfigFromEntry(body.data);
            if (mapped) {
              const previous = storage
                .getHabitConfigs(selfUserId)
                .find((c) => c.category === category);
              if (
                previous?.goalId &&
                mapped.goalId &&
                previous.goalId !== mapped.goalId
              ) {
                storage.swapLocalHabitGoalId(previous.goalId, mapped.goalId);
              }
              storage.upsertHabitConfig(selfUserId, mapped);
            }
          }
        } catch (err) {
          console.warn(
            "[sync] PUT habit config succeeded but id-swap failed; local id will reconcile on the next refresh:",
            err,
          );
        }
      }

      storage.markMutationCompleted(entry.id);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      // ⚠ TRANSPORT failure — `fetch` itself rejected, so we never received an
      // answer and cannot know whether the server saw the request. No attempt was
      // made in the sense the retry budget measures, so charging it is wrong.
      //
      // This is the offline case, and it mattered because the drain does not
      // consult connectivity: it fires on mount, on every foreground transition,
      // on reconnect, from a dozen inline call sites, and (new on this branch) on
      // enqueue. With a 5s→20s backoff, ~25 seconds offline while the user keeps
      // using the app was enough to exhaust an entry — after which it is invisible
      // to every future drain, and `resurrectAndFlush` only rescues
      // `/sessions/record`. A workout created on the tube was simply gone.
      //
      // Deferring instead keeps it retryable, which is correct: an offline device
      // has made no statement about the request's validity. A genuine server
      // rejection still arrives as a `SyncHttpError` and still burns the budget
      // below.
      //
      // "Retryable" and not "retryable indefinitely": past
      // `MAX_TRANSPORT_DEFERRALS` this charges the budget after all, so an endpoint
      // that is permanently unreachable — or a throw from our own request-building
      // code, which lands here too and would otherwise loop invisibly forever —
      // still exhausts and still reaches the user.
      if (!(err instanceof SyncHttpError)) {
        deferOrCharge(storage, entry, message);
        failed++;
        continue;
      }

      // A permanent client error (4xx except 402/408/429) can never succeed on
      // a re-send, so mark it terminally `permanently_failed` NOW — no retry
      // budget burned, no "exhausted retries" masquerade. It still surfaces via
      // getFailedExhaustedEntries + Sentry, and stays recoverable via the Retry
      // CTA (resetFailedEntries) once a fix ships.
      const isPermanent =
        err instanceof SyncHttpError &&
        isPermanentClientError(err.status) &&
        // A 4xx on a mutation still pointing at an unsynced dependency's
        // `local-…` id is deferred, not permanent — it resolves on the next
        // drain once the dependency create's swapLocal*Id lands. Both the body
        // (nested references included) and the endpoint path can carry one.
        !referencesUnsyncedLocalId(entry.payload) &&
        !endpointReferencesUnsyncedLocalId(entry.endpoint);

      // Terminal failure: this attempt exhausts the retry budget, so the drain
      // will never pick this entry up again (`getPendingMutations` gates on
      // `retry_count < max_retries`) — a silently-stuck mutation with no user
      // recovery path. Compute this BEFORE `markMutationFailed`: it reads
      // `entry.retryCount` as the snapshot value (pre-increment) for both the
      // SQLite adapter and the in-memory double (which mutates the live entry).
      const isTerminalFailure =
        isPermanent || entry.retryCount + 1 >= entry.maxRetries;

      if (isPermanent) {
        storage.markMutationPermanentlyFailed(entry.id, message);
      } else {
        storage.markMutationFailed(entry.id, message);
      }
      failed++;
      // Report the terminal failure to Sentry so it isn't invisible (the
      // local-workout-id 500 went unseen for exactly this reason). Best-effort:
      // a telemetry failure must never break the drain.
      if (isTerminalFailure) {
        try {
          captureSyncFailure({
            endpoint: entry.endpoint,
            entityType: entry.entityType,
            operation: entry.operation,
            message,
          });
        } catch {
          // swallow — telemetry is not allowed to affect sync outcomes
        }
      }
    }
  }

  // Clean up old completed entries
  storage.pruneCompletedMutations();

  // `processed` counts entries this drain actually OWNED — skipped
  // entries (claimed by a concurrent drain via the conditional
  // `markMutationInFlight`) are NOT included, since they belong to
  // the other drain's `processed` count. With M10.6's 402 path the
  // invariant widens to `processed === succeeded + failed + blocked`.
  return {
    processed: succeeded + failed + blocked,
    succeeded,
    failed,
    blocked,
  };
}

/**
 * Translate a raw 402 response body string into an `EntitlementVerdict`
 * suitable for `storage.markMutationBlocked`. Returns null when the
 * body isn't a parseable JSON object, when the `code` discriminator
 * isn't `"ENTITLEMENT_DENIED"`, or when required fields are missing /
 * wrong-typed. Callers fall back to the generic failure path on null.
 *
 * `blockedAt` is stamped at the verdict-creation moment (now ISO),
 * NOT pulled from the server — useful for "blocked X minutes ago"
 * sort order on the review screen.
 */
function parseEntitlementBlockedVerdict(
  body: string,
): EntitlementVerdict | null {
  const payload = parseEntitlementDeniedResponseText(body);
  if (payload === null) return null;
  return {
    feature: payload.feature as EntitlementVerdict["feature"],
    currentTier: payload.currentTier as EntitlementVerdict["currentTier"],
    upgradeTo: payload.upgradeTo as EntitlementVerdict["upgradeTo"],
    upgradePriceMonthly: payload.upgradePriceMonthly,
    blockedAt: new Date().toISOString(),
  };
}
