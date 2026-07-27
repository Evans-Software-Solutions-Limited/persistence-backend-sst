import { isMutationDue, processSyncQueue } from "../sync.command";
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
