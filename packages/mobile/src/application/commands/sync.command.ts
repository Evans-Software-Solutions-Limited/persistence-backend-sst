import type { AuthPort } from "@/domain/ports/auth.port";
import type {
  RecordResponseSummary,
  RecordResponseSummaryPR,
  StoragePort,
} from "@/domain/ports/storage.port";
import type { EntitlementVerdict } from "@/domain/ports/sync.types";
import type { HabitConfigEntry } from "@/domain/ports/api.port";
import { habitConfigFromEntry } from "@/domain/models/habit-config";
import { normalizePreferences } from "@/domain/models/notification-preferences";
import { pendingPreferenceOverrides } from "@/application/notifications/queries/preferences.query";
import { parseEntitlementDeniedResponseText } from "@/shared/errors/parseEntitlement";

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
): Promise<SyncResult> {
  const entries = storage.getPendingMutations();
  let succeeded = 0;
  let failed = 0;
  let blocked = 0;

  for (const entry of entries) {
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

      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers,
        body: entry.method !== "DELETE" ? entry.payload : undefined,
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
        throw new Error(`HTTP ${response.status}: ${body}`);
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
      storage.markMutationFailed(entry.id, message);
      failed++;
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
