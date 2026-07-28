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
    (entry as { idempotencyKey: string | null }).idempotencyKey = null;
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

  it("discards a sibling stranded on the local id when a create dies terminally", async () => {
    // A queued `DELETE /exercises/local-…` parked behind an in-flight create (the
    // path delete-exercise deliberately takes) can only ever be rewritten by the
    // id swap that runs when the create SUCCEEDS. Once the create is permanently
    // rejected, that sibling is aimed forever at a path Postgres rejects with
    // 22P02 — it burns its budget and surfaces as "Invalid identifier format" for
    // a row the user was told was deleted.
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

    const remaining = storage.getQueuedEntriesForEntity("exercise", "local-e9");
    expect(remaining.map((e) => e.operation)).toEqual(["create"]);
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
