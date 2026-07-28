import {
  isMutationDue,
  processSyncQueue,
  MAX_TRANSPORT_DEFERRALS,
} from "../sync.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { refreshWorkouts } from "@/application/queries/workouts.query";
import type { ApiPort } from "@/domain/ports/api.port";
import type { Workout } from "@/domain/models/workout";
import { ok } from "@/shared/errors";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

const AFTER_BACKOFF = { now: () => Date.now() + 10 * 60_000 };

function workout(id: string, name = "Push"): Workout {
  return {
    id,
    name,
    description: null,
    createdBy: "u1",
    visibility: "private",
    estimatedDurationMinutes: 30,
    showInOwnerLibrary: true,
    exercises: [],
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
  };
}

describe("isMutationDue", () => {
  it("is due when no window is set", () => {
    expect(isMutationDue({ nextAttemptAt: null })).toBe(true);
  });

  it("is not due before the window opens", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isMutationDue({ nextAttemptAt: future })).toBe(false);
  });

  it("is due once the window has passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isMutationDue({ nextAttemptAt: past })).toBe(true);
  });

  it("treats SQLite's zone-less UTC format as UTC, not local time", () => {
    // `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" with no zone marker, which
    // Date.parse reads as LOCAL. In a UTC+N zone that would make a just-stamped
    // window look hours in the past (retry immediately, no backoff); in UTC-N,
    // hours in the future (a mutation stuck for hours). Both are wrong.
    const nowMs = Date.UTC(2026, 6, 27, 12, 0, 0);
    const stamped = "2026-07-27 12:00:30"; // 30s in the future, UTC
    expect(isMutationDue({ nextAttemptAt: stamped }, nowMs)).toBe(false);
    expect(isMutationDue({ nextAttemptAt: stamped }, nowMs + 31_000)).toBe(
      true,
    );
  });

  it("treats an unparseable window as DUE rather than stranding the entry", () => {
    expect(isMutationDue({ nextAttemptAt: "not a date" })).toBe(true);
  });
});

describe("idempotency key", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    mockFetch.mockReset();
  });

  it("sends an Idempotency-Key header", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    const headers = mockFetch.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("re-sends the SAME key on a retry — that is the whole property", async () => {
    // A key regenerated per attempt would make every retry look like a new
    // request, guaranteeing the duplicate this mechanism exists to prevent.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "boom",
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");
    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);

    const first = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    const second = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });

  it("gives two distinct mutations distinct keys", async () => {
    for (const id of ["local-w1", "local-w2"]) {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: id,
        operation: "create",
        payload: { name: id },
        endpoint: "/workouts",
        method: "POST",
      });
    }
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    const a = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    const b = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(a["Idempotency-Key"]).not.toBe(b["Idempotency-Key"]);
  });

  it("omits the header entirely for a row that predates the column", async () => {
    // Preserves exactly the old behaviour for legacy rows rather than inventing
    // a key that would differ per attempt.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
    const [entry] = storage.getPendingMutations();
    // Via the double's explicit test mutator: queue reads are snapshots, matching
    // the real adapter, so assigning to the returned entry would change nothing.
    storage.patchQueueEntryForTest(entry.id, { idempotencyKey: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    const headers = mockFetch.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("in-flight recovery", () => {
  it("returns stranded in_flight entries to pending and reports the count", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "session",
      entityId: "s1",
      operation: "create",
      payload: {},
      endpoint: "/sessions/record",
      method: "POST",
    });
    const [entry] = storage.getPendingMutations();
    storage.markMutationInFlight(entry.id);
    // Stranded: invisible to the drain AND to the review UI.
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getFailedExhaustedEntries()).toHaveLength(0);

    expect(storage.recoverInFlightMutations()).toBe(1);
    expect(storage.getPendingMutations()).toHaveLength(1);
  });

  it("is a no-op when nothing is in flight", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    expect(storage.recoverInFlightMutations()).toBe(0);
  });
});

describe("refreshWorkouts write-through", () => {
  let storage: InMemoryStorageAdapter;

  function apiReturning(workouts: Workout[]): ApiPort {
    return {
      getWorkouts: jest.fn(async () => ok({ workouts, quota: null })),
    } as unknown as ApiPort;
  }

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("preserves an optimistic local row the server does not know about", async () => {
    // The silent data loss: `cacheWorkoutsList` REPLACES the slice, so a
    // successful GET used to delete a workout whose create hadn't landed — and
    // every later refresh did it again.
    storage.cacheWorkoutsList(
      "u1",
      "mine",
      [workout("local-w1", "Mine")],
      null,
    );
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    await refreshWorkouts(
      apiReturning([workout("server-w9", "Server")]),
      storage,
      "u1",
      "mine",
    );

    const cached = storage.getCachedWorkoutsList("u1", "mine");
    expect(cached?.workouts.map((w) => w.id)).toEqual([
      "local-w1",
      "server-w9",
    ]);
  });

  it("does NOT preserve a local row whose create has COMPLETED", async () => {
    // Server-truth now owns it (the id may just not have been swapped yet).
    // Preserving it would resurrect a workout deleted server-side.
    storage.cacheWorkoutsList("u1", "mine", [workout("local-w1")], null);
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    const [entry] = storage.getPendingMutations();
    storage.markMutationCompleted(entry.id);

    await refreshWorkouts(
      apiReturning([workout("server-w9")]),
      storage,
      "u1",
      "mine",
    );

    expect(
      storage.getCachedWorkoutsList("u1", "mine")?.workouts.map((w) => w.id),
    ).toEqual(["server-w9"]);
  });

  it("does not preserve a server-id row that happens to be cached", async () => {
    storage.cacheWorkoutsList("u1", "mine", [workout("real-w1")], null);

    await refreshWorkouts(
      apiReturning([workout("server-w9")]),
      storage,
      "u1",
      "mine",
    );

    expect(
      storage.getCachedWorkoutsList("u1", "mine")?.workouts.map((w) => w.id),
    ).toEqual(["server-w9"]);
  });

  it("leaves the cache untouched when the fetch fails", async () => {
    storage.cacheWorkoutsList("u1", "mine", [workout("local-w1")], null);
    const api = {
      getWorkouts: jest.fn(async () => ({
        ok: false as const,
        error: { kind: "api" as const, code: "server" as const, message: "no" },
      })),
    } as unknown as ApiPort;

    const result = await refreshWorkouts(api, storage, "u1", "mine");

    expect(result.ok).toBe(false);
    expect(
      storage.getCachedWorkoutsList("u1", "mine")?.workouts.map((w) => w.id),
    ).toEqual(["local-w1"]);
  });
});

describe("deferral does not consume the retry budget", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    mockFetch.mockReset();
  });

  function enqueueWorkoutCreate(): void {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
  }

  it("an OFFLINE (transport) failure leaves retryCount at zero", async () => {
    // The reported loss: the drain never consults connectivity and fires on
    // mount, foreground, reconnect, a dozen inline call sites and now on enqueue.
    // At 5s→20s backoff, ~25s offline used to exhaust the entry, after which only
    // /sessions/record is ever auto-resurrected — so a workout created offline
    // was simply gone.
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    await processSyncQueue(storage, auth, "https://api.test");

    const [entry] = storage.getPendingMutations();
    expect(entry.status).toBe("failed");
    expect(entry.retryCount).toBe(0);
    expect(entry.nextAttemptAt).not.toBeNull();
  });

  it("survives an offline stretch far longer than the old 3-attempt budget", async () => {
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    for (let i = 0; i < 6; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    expect(storage.getPendingMutations()).toHaveLength(1);
    expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
  });

  it("but the free run is BOUNDED — it escalates and becomes visible", async () => {
    // Budget-free must not mean consequence-free. A deferred entry appears on NO
    // sync surface: getFailedExhaustedEntries gates on retryCount >= maxRetries,
    // and it is the sole source for both the sync-failed banner
    // (SyncFailedBannerMount) and the review screen (SyncFailedContainer). So an
    // endpoint that can never be reached — or a throw from our own request-building
    // code, which lands on the same branch — would otherwise retry silently for the
    // life of the install, with no banner and no way to discard it.
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    // Past the ceiling, then enough charged attempts to exhaust the budget.
    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS + 5; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    const exhausted = storage.getFailedExhaustedEntries();
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].entityId).toBe("local-w1");
  });

  it("charges nothing right up to the ceiling, then charges", async () => {
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }
    // Exactly at the ceiling: every drain so far was free.
    expect(storage.getPendingMutations()[0].retryCount).toBe(0);
    expect(storage.getPendingMutations()[0].deferCount).toBe(
      MAX_TRANSPORT_DEFERRALS,
    );

    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    expect(storage.getPendingMutations()[0].retryCount).toBe(1);
  });

  it("reports the ceiling escalation to Sentry once it exhausts", async () => {
    // The two cases the ceiling exists to surface — a throw from our own
    // request-building code, and an `unresolvable` catalogue member — reach this
    // function, NOT the SyncHttpError branch that carries the Sentry call. Without
    // an explicit report they'd reach the user's banner and never the team.
    const { captureSyncFailure } = jest.requireMock("@/lib/sentry") as {
      captureSyncFailure: jest.Mock;
    };
    captureSyncFailure.mockClear();
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS + 5; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    expect(captureSyncFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/workouts", operation: "create" }),
    );
  });

  it("clears BOTH entries when a permanently-rejected create has a stranded delete", async () => {
    // A queued `DELETE /exercises/local-…` parked behind an in-flight create (the
    // path delete-exercise deliberately takes) can only ever be rewritten by the
    // id swap that runs when the create SUCCEEDS. Once the create is permanently
    // rejected, that sibling is aimed forever at a path Postgres rejects with
    // 22P02 — it burns its budget and surfaces as "Invalid identifier format" for
    // a row the user was told was deleted.
    //
    // The create goes too: a stranded delete is terminal intent for the whole
    // entity. Leaving it behind was how a deleted row came back (see the
    // transient-exhaustion sibling of this test — that is the resurrectable case).
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e9",
      operation: "create",
      payload: { name: "Lift" },
      endpoint: "/exercises",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e9",
      operation: "delete",
      payload: {},
      endpoint: "/exercises/local-e9",
      method: "DELETE",
    });
    // 400 on the create with no local reference in its own body/endpoint → permanent.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(storage.getQueuedEntriesForEntity("exercise", "local-e9")).toEqual(
      [],
    );
  });

  it("folds a stranded EDIT onto the dying create instead of dropping the user's change", async () => {
    // The two fixes that landed together in ae3d384e cancelled each other out:
    // `canRewriteWithoutReplayingKey` deliberately declines to coalesce into a
    // dispatched create and enqueues a separate PATCH /exercises/local-… — and the
    // sibling cleanup then deleted exactly that entry, leaving the create carrying
    // the PRE-edit body. A Retry re-sent the original name, the id swap ran, the
    // next write-through replaced the cached row with server truth, and the edit
    // vanished with no error: precisely the silent loss the guard exists to prevent.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e8",
      operation: "create",
      payload: { name: "Original" },
      endpoint: "/exercises",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e8",
      operation: "update",
      payload: { name: "Renamed by user" },
      endpoint: "/exercises/local-e8",
      method: "PATCH",
    });
    // A 400 on the create with no local reference of its own → permanent.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    const remaining = storage.getQueuedEntriesForEntity("exercise", "local-e8");
    // One entry, the create — and it now carries the user's latest body, so
    // whichever route re-opens it (Retry, a further edit, reconnect) sends that.
    expect(remaining).toHaveLength(1);
    expect(remaining[0].operation).toBe("create");
    expect(JSON.parse(remaining[0].payload).name).toBe("Renamed by user");
  });

  it("does not silently resurrect an EXHAUSTED create while folding into it", async () => {
    // A permanently_failed create must be re-opened before the rewrite (the
    // status-conditional updateMutationPayload no-ops otherwise), but an exhausted
    // one is already rewritable — re-opening it would resurrect a create the user
    // never asked to retry.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e7",
      operation: "create",
      payload: { name: "Original" },
      endpoint: "/exercises",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e7",
      operation: "update",
      payload: { name: "Renamed by user" },
      endpoint: "/exercises/local-e7",
      method: "PATCH",
    });
    // 5xx → transient, so the create exhausts its budget rather than going permanent.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    for (let i = 0; i < 4; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    const exhausted = storage.getFailedExhaustedEntries();
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].operation).toBe("create");
    // Still terminal (not silently re-opened) AND carrying the edit.
    expect(JSON.parse(exhausted[0].payload).name).toBe("Renamed by user");
  });

  it("discards the CREATE too when a stranded DELETE is collapsed", async () => {
    // Data resurrection, verified end-to-end. Delete a never-synced workout offline
    // (delete-workout evicts the cache and enqueues DELETE /workouts/local-w1, with
    // no create-cancellation of its own), stay offline until the create exhausts:
    // the collapse folded nothing (the sibling is a delete, not an update) and
    // discarded it, leaving a create that satisfies EVERY clause of useSyncWorker's
    // replaySafe filter — status 'failed', operation 'create', a non-null
    // idempotencyKey, endpoint '/workouts'. The next reconnect resurrected it, the
    // POST landed, and no DELETE remained to undo it: the workout the user deleted
    // reappeared on the next refresh and consumed a slot against their quota.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w1",
      operation: "delete",
      payload: {},
      endpoint: "/workouts/local-w1",
      method: "DELETE",
    });
    // 5xx → transient, so the create EXHAUSTS rather than going permanently_failed.
    // That distinction is the whole point: only `failed` is resurrectable, so the
    // existing permanent-400 test could never have caught this.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    for (let i = 0; i < 4; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    // THE invariant: a create is never left resurrectable ON ITS OWN. Either both
    // rows go (only when nothing can have committed), or both stay so the delete
    // still follows the create through the id swap. A lone create IS the
    // resurrection bug — it satisfies every clause of `replaySafe` with nothing
    // left to undo it.
    const ops = storage
      .getQueuedEntriesForEntity("workout", "local-w1")
      .map((e) => e.operation)
      .sort();
    expect(ops).not.toEqual(["create"]);
    if (ops.length > 0) expect(ops).toEqual(["create", "delete"]);
  });

  it("MERGES the folded edit onto the create rather than replacing the body", async () => {
    // A PATCH is allowed to be partial. An athlete-context workout edit omits
    // `showInOwnerLibrary` entirely (WorkoutEditorContainer sets it only for a
    // coach, and JSON.stringify drops undefined), so replacing the body made the
    // handler apply its `?? true` default — and a workout the coach authored FOR A
    // CLIENT surfaced in the coach's own My Workouts.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w2",
      operation: "create",
      payload: { name: "Client Push", showInOwnerLibrary: false },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w2",
      operation: "update",
      payload: { name: "Client Push v2" },
      endpoint: "/workouts/local-w2",
      method: "PATCH",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    for (let i = 0; i < 4; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    const [survivor] = storage.getFailedExhaustedEntries();
    const body = JSON.parse(survivor.payload);
    expect(body.name).toBe("Client Push v2"); // the edit applied…
    expect(body.showInOwnerLibrary).toBe(false); // …without dropping the rest
  });

  it("collapses siblings on the FINAL charged attempt, not one attempt early", async () => {
    // The ceiling path computed its exhaustion test AFTER markMutationFailed. That is
    // correct against the SQLite adapter (the drain holds a snapshot) but the
    // in-memory double returns LIVE references, so the already-incremented value made
    // the `+ 1` unobservable: weakening the condition to `>= maxRetries` left all 113
    // sync tests green, while in production it disabled both the Sentry report and the
    // sibling collapse for this entire path — and the ceiling is the ONLY route to the
    // collapse for an offline-deferred row, since a deferral never raises a
    // SyncHttpError. This drives an entry to death purely through transport failures
    // and asserts the collapse fires exactly once it is spent.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e5",
      operation: "create",
      payload: { name: "Lift" },
      endpoint: "/exercises",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e5",
      operation: "update",
      payload: { name: "Renamed" },
      endpoint: "/exercises/local-e5",
      method: "PATCH",
    });
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    // Free deferrals first: nothing charged, so nothing collapsed yet.
    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }
    expect(
      storage.getQueuedEntriesForEntity("exercise", "local-e5"),
    ).toHaveLength(2);

    // Charged attempts. maxRetries is 3, so the third is the one that exhausts.
    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    expect(
      storage.getQueuedEntriesForEntity("exercise", "local-e5"),
    ).toHaveLength(2);

    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);

    // Now spent: the edit has been folded onto the create and the sibling dropped.
    const remaining = storage.getQueuedEntriesForEntity("exercise", "local-e5");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].operation).toBe("create");
    expect(JSON.parse(remaining[0].payload).name).toBe("Renamed");
  });

  it("keeps a dispatched create + its delete rather than losing a committed row", async () => {
    // The ambiguous failure this whole branch exists for: the POST is dispatched, the
    // server commits, the connection drops before the response, `fetch` rejects.
    // Discarding both rows there leaves the workout ON THE SERVER and gone locally,
    // so the next refresh re-materialises the row the user deleted — the same harm
    // the delete-guard was added to prevent, by the opposite route. Both entries
    // survive so the create can replay idempotently, the id swap can rewrite the
    // DELETE's endpoint, and the delete can land on the real resource.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w3",
      operation: "create",
      payload: { name: "Push" },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-w3",
      operation: "delete",
      payload: {},
      endpoint: "/workouts/local-w3",
      method: "DELETE",
    });
    // Transport failure only — every attempt leaves the device, so the server may
    // have seen any of them.
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS + 5; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }

    const create = storage
      .getQueuedEntriesForEntity("workout", "local-w3")
      .find((e) => e.operation === "create");
    expect(create).toBeDefined();
    expect(create!.dispatchCount).toBeGreaterThan(0);
    expect(
      storage
        .getQueuedEntriesForEntity("workout", "local-w3")
        .some((e) => e.operation === "delete"),
    ).toBe(true);
  });

  it("classifies a MISSING catalogue as transport, so a reconnect can heal it", async () => {
    // `catalogue_unavailable` says "waiting for the reference list", and that list
    // arrives over the network — so connectivity does change its verdict. Filing it
    // as `resolution` meant the reconnect self-heal skipped it and an exercise queued
    // while the catalogue was cold exhausted without a single request leaving the
    // device. Reachable: `useReferenceListBootstrap` swallows a failed fetch and does
    // not retry within the session.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e6",
      operation: "create",
      payload: { name: "Lift", primary_muscles: ["chest"] },
      endpoint: "/exercises",
      method: "POST",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(mockFetch).not.toHaveBeenCalled();
    const [entry] = storage.getPendingMutations();
    expect(entry.deferKind).toBe("transport");
  });

  it("classifies an UNRESOLVABLE member as resolution, so it still reaches the user", async () => {
    // The counter-case, so the test above can fail: a member absent from a catalogue
    // we already HOLD will never resolve, whatever the network does. It must converge
    // on the ceiling and surface rather than being postponed forever.
    storage.cacheReferenceList("muscle_groups", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Chest",
        displayName: "Chest",
      },
    ]);
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e6b",
      operation: "create",
      payload: { name: "Lift", primary_muscles: ["not_a_muscle"] },
      endpoint: "/exercises",
      method: "POST",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(mockFetch).not.toHaveBeenCalled();
    const [entry] = storage.getPendingMutations();
    expect(entry.deferKind).toBe("resolution");
  });

  it("an explicit Retry restores the full free run", async () => {
    // A Retry (or a reconnect resurrect) is new information — usually the very
    // connectivity whose absence caused the deferrals — so the entry must not be
    // left one transport failure away from exhausting again.
    enqueueWorkoutCreate();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    for (let i = 0; i < MAX_TRANSPORT_DEFERRALS + 5; i++) {
      await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    }
    const [stranded] = storage.getFailedExhaustedEntries();
    storage.resetFailedEntries([stranded.id]);

    const [reset] = storage.getPendingMutations();
    expect(reset.retryCount).toBe(0);
    expect(reset.deferCount).toBe(0);

    await processSyncQueue(storage, auth, "https://api.test", AFTER_BACKOFF);
    // Still free, not charged.
    expect(storage.getPendingMutations()[0].retryCount).toBe(0);
  });

  it("a real server rejection DOES still burn the budget", async () => {
    // The counter-case: a 5xx is an answer, so it must remain chargeable —
    // otherwise nothing would ever reach the review UI.
    enqueueWorkoutCreate();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(storage.getPendingMutations()[0].retryCount).toBe(1);
  });

  it("a catalogue deferral leaves retryCount at zero", async () => {
    // `unresolvable`/`catalogue_unavailable` are explicitly NOT transient, so
    // they must not spend a transient budget.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-e1",
      operation: "create",
      payload: { name: "Lift", primary_muscles: ["chest"] },
      endpoint: "/exercises",
      method: "POST",
    });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(mockFetch).not.toHaveBeenCalled();
    const [entry] = storage.getPendingMutations();
    expect(entry.retryCount).toBe(0);
    expect(entry.status).toBe("failed");
  });
});
