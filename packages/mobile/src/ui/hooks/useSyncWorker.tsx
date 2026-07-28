import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  isMutationDue,
  processSyncQueue,
} from "@/application/commands/sync.command";
import { getApiBaseUrl } from "@/adapters/api";
import { SYNC_QUEUE_TABLES } from "@/adapters/storage";
import type { StoragePort } from "@/domain/ports/storage.port";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Debounce window for the reconnect-triggered resurrect + flush (Task 2,
 * M13 sync-hardening). A flaky wifi handoff or airplane-mode toggle can
 * fire several rapid false→true transitions in a row — this collapses
 * them so only the LAST transition in a burst actually resets + flushes,
 * instead of hammering the queue once per blip.
 *
 * Exported so tests can assert against the exact cadence.
 */
export const SYNC_RECONNECT_DEBOUNCE_MS = 1_000;

/**
 * Is there at least one queue entry eligible to be sent right now?
 *
 * Used as the drain loop's continue-condition. Wrapped so a storage failure
 * reads as "nothing due" rather than spinning the loop on a throw.
 */
function hasWorkDue(storage: StoragePort): boolean {
  try {
    // The SAME predicate the drain skips by. If these disagreed, the loop would
    // spin forever on an entry `processSyncQueue` always passes over.
    return storage.getPendingMutations().some((e) => isMutationDue(e));
  } catch (err) {
    console.error("[useSyncWorker] could not read the queue:", err);
    return false;
  }
}

/**
 * Drain the sync queue at app launch, on every foreground transition, and
 * on an offline→online reconnect (M13 sync-hardening).
 *
 * Without this, mutations (workout create/edit/delete, exercise
 * create/delete) only land in the local SQLite cache via
 * `enqueueMutation` — `processSyncQueue` is the worker that actually
 * POSTs them to the SST backend. M0 + M1 were read-only so this gap
 * went unnoticed; M2 ships the first mutation surface and surfaces it.
 *
 * Wiring rules:
 * - Run once on mount when an authenticated session is available.
 *   The hook reads `session?.userId` to gate the first run; without
 *   a session the queue stays paused (prevents POSTs with stale or
 *   anonymous tokens after sign-out).
 * - Run on `AppState change → active`. Catches the common case of
 *   user backgrounding mid-edit while offline, then returning with
 *   connectivity restored.
 * - Run on a NetInfo false→true reconnect transition (M13). This is the
 *   fix for the "stranded mutation" bug: `getPendingMutations()`
 *   deliberately excludes entries that have exhausted their retry
 *   budget (`status='failed' AND retry_count >= max_retries`), so a
 *   `POST /sessions/record` that failed 3 times during an offline
 *   stretch was invisible to EVERY future drain — every server-derived
 *   view (coach adherence, workout-detail PR state, the You-page volume
 *   stat) read empty forever even after connectivity came back. On a
 *   real false→true transition we now `resetFailedEntries` ONCE for the
 *   entries whose replay the SERVER can recognise — session records via
 *   `clientSessionId`, and (since the offline-sync-hardening branch)
 *   workout + exercise creates via `clientRequestId` — then flush. That
 *   is a self-heal for a failure that was plausibly connectivity rather
 *   than a genuine rejection.
 *
 *   Two exclusions, both deliberate: an endpoint with NO server-side key
 *   (nutrition creates) is never auto-resurrected, because a re-POST
 *   could duplicate a row that did commit; and `permanently_failed`
 *   entries are never resurrected whatever their endpoint, because that
 *   state means a re-send of the identical request cannot succeed. Both
 *   surface in the `/sync-failed` review UI for explicit retry instead.
 *   The same transition also restores the budget-free deferral run of
 *   still-queued entries, since a reconnect is exactly the information
 *   whose absence caused them.
 *
 * Not in scope here (deferred to a follow-up):
 * - Debounced flush after enqueue
 * - Periodic background polling
 *
 * Mount once, near the auth boundary, in the authenticated layout.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008 AC 8.3
 *       (sync queue replays optimistic mutations to the backend)
 *       specs/milestones/M13-sync-hardening
 */
export function useSyncWorker(): void {
  const { storage, auth, netInfo } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // Avoid concurrent flushes — `processSyncQueue` walks pending entries
  // serially, so two overlapping calls would double-mark the same row
  // in-flight. The flag is reset in the finally block.
  const flushingRef = useRef(false);
  // Set when a flush is requested while one is already in progress — the
  // active drain re-runs one more pass on finish so entries enqueued or
  // resurrected mid-flush (notably the reconnect resurrect below) aren't
  // stranded until the next foreground/reconnect trigger.
  const reflushRef = useRef(false);
  // Last-observed connectivity state. `null` until the FIRST signal
  // (either the one-shot probe below or the first `subscribe` callback)
  // arrives — that first signal only SEEDS this ref, it never counts as
  // a transition (mirrors `useAutoRetryOnUpgrade`'s "first observation
  // seeds, doesn't act" rule; otherwise a cold start on an already-online
  // device would spuriously fire a resurrect+flush on mount).
  const prevConnectedRef = useRef<boolean | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const flush = async () => {
      // Already draining — record that another pass is wanted and let the
      // in-progress loop pick it up, rather than no-op'ing the caller
      // (which would strand a just-resurrected entry: the running drain
      // captured its pending list before the reset).
      if (flushingRef.current) {
        reflushRef.current = true;
        return;
      }
      flushingRef.current = true;
      try {
        do {
          reflushRef.current = false;
          try {
            await processSyncQueue(storage, auth, getApiBaseUrl());
          } catch (err) {
            // The worker itself catches per-entry errors and marks them
            // failed; an unexpected throw here means something at the
            // shell level (e.g. invalid base URL) is wrong. Log and
            // keep going — next foreground attempt may succeed.
            console.error("[useSyncWorker] flush failed:", err);
          }
          // Loop again if a flush was explicitly requested during this pass, OR
          // if the queue still holds work that is DUE — which covers a mutation
          // enqueued mid-flush (whose bus event this pass deliberately ignored).
          //
          // Terminates because the due-set strictly shrinks: a success moves the
          // entry to `completed`, a failure stamps `next_attempt_at` so it is no
          // longer due, and a claim lost to a concurrent drain belongs to that
          // drain. `getPendingMutations` throwing (a broken cache) must not spin,
          // so treat an error as "nothing due".
        } while (reflushRef.current || hasWorkDue(storage));
      } finally {
        flushingRef.current = false;
      }
    };

    // M13: one-shot self-heal on reconnect, then flush. Best-effort —
    // any failure here still falls through to `flush()` so a resurrect
    // bug never blocks the ordinary drain.
    const resurrectAndFlush = async () => {
      try {
        // Give still-queued entries their budget-free run back. A reconnect is
        // exactly the new information whose absence caused the deferrals, and
        // without this an offline stretch of ~90–120s (12 free deferrals at a 5s
        // window, then 3 charged attempts) exhausted an offline-created workout
        // during ordinary use — a commute, a basement gym — leaving the user a
        // sync-failure banner to resolve by hand. This also clears
        // `nextAttemptAt`, so the flush below actually sends them now rather than
        // waiting out a window set while there was no network.
        //
        // ⚠ TRANSPORT deferrals only. A `resolution` deferral (a reference
        // catalogue that couldn't be resolved) is not informed by connectivity, and
        // re-arming it re-created the very hole `MAX_TRANSPORT_DEFERRALS` was
        // invented to close: an exercise naming a catalogue entry that does not yet
        // exist had its counters zeroed on every reconnect, so it could never reach
        // the ceiling — no banner, no review row, never sent, lost on reinstall.
        // That has a real trigger population: the `machine` → "Machine" mapping
        // depends on 20260727120000_equipment_types_generic_machine.sql being
        // applied by hand to production, so every exercise saved with the Machine
        // option before that lands is exactly this case.
        const deferred = storage
          .getPendingMutations()
          .filter((e) => e.deferCount > 0 && e.deferKind === "transport");
        if (deferred.length > 0) {
          storage.resetFailedEntries(deferred.map((e) => e.id));
        }

        // Auto-resurrect exhausted entries the SERVER can safely dedup on replay.
        // A re-POST is only safe where the server recognises the retry as the same
        // logical request; otherwise it could duplicate a row that did commit, and
        // those stay in /sync-failed for explicit, user-acknowledged retry.
        //
        // This list used to be `/sessions/record` alone, and its comment said the
        // other creates "have NO idempotency key". That is no longer true — this
        // branch added `client_request_id` to workout and exercise creates with the
        // same (created_by, key) unique-index treatment `client_session_id` has had
        // since M13 — so they now qualify on identical reasoning. Nutrition creates
        // still do not: no server-side key column, so they are deliberately absent.
        const exhausted = storage.getFailedExhaustedEntries();
        const replaySafe = exhausted.filter(
          (e) =>
            // ⚠ `getFailedExhaustedEntries` returns `permanently_failed` entries
            // too, and those must NOT be resurrected: that state exists precisely
            // to mean "a re-send of the identical request can never turn into a
            // 2xx". Sweeping them up re-POSTed a rejected body on every single
            // reconnect for the life of the install, each time briefly removing the
            // row from /sync-failed (it leaves `getFailedExhaustedEntries` between
            // the reset and the re-failure) so the banner flickered. Only
            // TRANSIENT exhaustion — plausibly connectivity — is self-healed here.
            e.status === "failed" &&
            // ⚠ And not a `resolution` deferral, for the same reason the filter
            // above excludes them — otherwise this clause silently undid that one.
            // `resetFailedEntries` zeroes retry_count, defer_count AND defer_kind,
            // so an entry that had just climbed the full 12-deferral + 3-retry
            // ladder into /sync-failed was dropped straight back to `pending` on the
            // next connectivity blip: visible only in the window between exhausting
            // and the next transition, which on a phone that moves is potentially
            // never. `defer_kind` survives `markMutationFailed` untouched, so it is
            // still readable on the exhausted row.
            e.deferKind !== "resolution" &&
            // Both self and on-behalf (`.../clients/:id/sessions/record`) forms.
            (e.endpoint.endsWith("/sessions/record") ||
              (e.operation === "create" &&
                e.idempotencyKey !== null &&
                (e.endpoint === "/workouts" || e.endpoint === "/exercises"))),
        );
        // ⚠ Resurrect the PAIR, not just the create. A create and a follow-up
        // delete/edit against its `local-…` id climb the ladder in lockstep and
        // exhaust on the same pass, and the filter above only matches the create
        // (`operation === "create"`). Resetting it alone re-POSTed the create with
        // nothing left to undo it — so a workout the user created and then deleted
        // offline was CREATED on the server by the reconnect, absent locally, and
        // reappeared on the next list refresh consuming a quota slot. Strictly worse
        // than the behaviour it replaced.
        //
        // Safe to include the siblings: `swapLocal*Id` rewrites their endpoint
        // unconditionally of status when the create lands, a DELETE replay is
        // idempotent, and an UPDATE simply follows the id swap. Only `failed`
        // siblings are taken — a `permanently_failed` one was explicitly rejected,
        // and `resetFailedEntries` would otherwise re-open it (it accepts both).
        const idsToReset = new Set(replaySafe.map((e) => e.id));
        for (const create of replaySafe) {
          if (create.entityId === null) continue;
          for (const sibling of storage.getQueuedEntriesForEntity(
            create.entityType,
            create.entityId,
          )) {
            if (sibling.id !== create.id && sibling.status === "failed") {
              idsToReset.add(sibling.id);
            }
          }
        }
        if (idsToReset.size > 0) {
          storage.resetFailedEntries([...idsToReset]);
        }
      } catch (err) {
        console.error("[useSyncWorker] reconnect resurrect failed:", err);
      }
      await flush();
    };

    // Recover mutations stranded `in_flight` by a previous process death before
    // the first drain. Nothing else ever returned them to the pool — they were
    // invisible to every drain AND to /sync-failed, while `getSyncStats().inFlight`
    // kept counting them, so the UI could sit on "Syncing…" forever. Safe here
    // because no drain can be running in a process that has only just started,
    // and the re-POST is now covered by the entry's idempotency key.
    try {
      const recovered = storage.recoverInFlightMutations();
      if (recovered > 0) {
        console.warn(
          `[useSyncWorker] recovered ${recovered} mutation(s) stranded in_flight by a previous session`,
        );
      }
    } catch (err) {
      console.error("[useSyncWorker] in-flight recovery failed:", err);
    }

    void flush();

    // Drive the drain from local writes, not just from app lifecycle. Previously
    // a mutation enqueued while ONLINE sat until the next foreground transition,
    // reconnect, or a screen that happened to drain before fetching — which is
    // why a pull-to-refresh was the thing that made a saved workout appear: it
    // was the only workouts surface that also PUSHED. Subscribing to the queue
    // table means an enqueue schedules its own flush.
    //
    // ⚠ The drain WRITES to `sync_queue` itself (claim, complete, fail, prune),
    // so every pass produces bus events. Calling `flush()` from here
    // unconditionally would therefore feed itself. Two things break the cycle:
    // events arriving mid-flush are ignored (the running pass re-checks the queue
    // before finishing, so nothing is missed), and the loop's continue-condition
    // is "is there still work DUE" — which strictly shrinks each pass, because a
    // success completes the entry and a failure stamps a backoff that makes it
    // not-yet-due.
    const queueUnsub = storage.subscribe(SYNC_QUEUE_TABLES, () => {
      if (flushingRef.current) return;
      void flush();
    });

    const appStateSub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          void flush();
        }
      },
    );

    let mounted = true;
    // Guards the one-shot probe below from clobbering a fresher value
    // the subscribe stream already produced — mirrors `useOnlineStatus`'s
    // `subscribeFired` race guard (Inspector Brad PR #72 pattern).
    let subscribeFired = false;

    netInfo
      .isConnected()
      .then((connected) => {
        if (mounted && !subscribeFired && prevConnectedRef.current === null) {
          prevConnectedRef.current = connected;
        }
      })
      .catch(() => {
        // Swallow probe failures — the subscribe stream (or the next
        // AppState/mount flush) will still drive the worker correctly.
      });

    const netInfoUnsub = netInfo.subscribe((connected) => {
      subscribeFired = true;
      const prev = prevConnectedRef.current;
      prevConnectedRef.current = connected;

      // Only a genuine false→true TRANSITION triggers the resurrect +
      // flush. `prev === null` (first-ever signal) seeds only; going
      // offline (connected === false) never triggers it; repeated
      // "online" signals with no intervening offline are a no-op too.
      if (prev !== false || connected !== true) return;

      // Debounce: rapid toggles collapse onto the LAST transition in
      // the window instead of firing once per blip.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void resurrectAndFlush();
      }, SYNC_RECONNECT_DEBOUNCE_MS);
    });

    return () => {
      mounted = false;
      queueUnsub();
      appStateSub.remove();
      netInfoUnsub();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [storage, auth, netInfo, userId]);
}
