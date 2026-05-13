import { processSyncQueue } from "../sync.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";

// Mock global fetch
const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

describe("processSyncQueue", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    mockFetch.mockReset();
  });

  it("returns zero counts when queue is empty", async () => {
    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });

  it("processes pending mutations successfully", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "w1" } }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("marks failed mutations and increments retry count", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });

    const stats = storage.getSyncStats();
    expect(stats.failed).toBe(1);
  });

  it("sends auth token when available", async () => {
    await auth.signInWithEmail("test@example.com", "password");

    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "update",
      payload: { name: "Pull Day" },
      endpoint: "/workouts/w1",
      method: "PATCH",
    });

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts/w1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("does not send body for DELETE requests", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "delete",
      payload: {},
      endpoint: "/workouts/w1",
      method: "DELETE",
    });

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts/w1",
      expect.objectContaining({ method: "DELETE", body: undefined }),
    );
  });

  it("processes multiple entries in FIFO order", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "First" },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w2",
      operation: "create",
      payload: { name: "Second" },
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({ processed: 2, succeeded: 2, failed: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("fetches token per-entry (not once for all)", async () => {
    const getTokenSpy = jest.spyOn(auth, "getAccessToken");
    await auth.signInWithEmail("test@example.com", "password");

    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w2",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    // Token should be fetched once per entry, not once globally
    expect(getTokenSpy).toHaveBeenCalledTimes(2);
    getTokenSpy.mockRestore();
  });

  it("captures POST /sessions/record response into the record-response cache slot (M3 Phase 3b cache-and-subscribe)", async () => {
    // Sign in so auth.getSession() returns a userId; the cache slot
    // is keyed by userId (single-active-session invariant).
    await auth.signInWithEmail("user-1@example.com", "password");
    const session = await auth.getSession();
    if (!session.ok || !session.value) throw new Error("seed failed");
    const userId = session.value.userId;

    storage.enqueueMutation({
      entityType: "session",
      entityId: "local-1",
      operation: "create",
      payload: { status: "completed" },
      endpoint: "/sessions/record",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "server-1",
          personalRecords: [
            {
              exerciseId: "ex-bench",
              exerciseName: "Bench Press",
              recordType: "1rm",
              newValue: 137.4,
              previousValue: 120,
              setId: "set-1",
            },
          ],
          totalWorkoutsCompleted: 12,
        },
      }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });

    // Cache slot populated with the augmented response.
    const cached = storage.getRecordResponse(userId);
    expect(cached).not.toBeNull();
    expect(cached?.localSessionId).toBe("local-1");
    expect(cached?.totalWorkoutsCompleted).toBe(12);
    expect(cached?.personalRecords).toHaveLength(1);
    expect(cached?.personalRecords[0]?.previousValue).toBe(120);
    expect(cached?.personalRecords[0]?.newValue).toBe(137.4);
  });

  it("caches totalWorkoutsCompleted=null (not 0) when the server response omits or nulls the field (Inspector Brad PR #62 regression)", async () => {
    // The medium-severity "fabricated zero" bug: pre-fix, `?? 0`
    // landed a literal 0 in the cache when the field was missing.
    // The Summary screen would then render "You've completed 0
    // total workouts" immediately after the user finished a
    // workout. Post-fix, missing/null fields stay null in the cache
    // so the presenter falls back to the em-dash + "Keep the
    // momentum going!" subtitle, exactly as it does pre-server.
    await auth.signInWithEmail("user-1@example.com", "password");
    const session = await auth.getSession();
    if (!session.ok || !session.value) throw new Error("seed failed");
    const userId = session.value.userId;

    storage.enqueueMutation({
      entityType: "session",
      entityId: "local-1",
      operation: "create",
      payload: {},
      endpoint: "/sessions/record",
      method: "POST",
    });

    // Response body OMITS totalWorkoutsCompleted entirely — simulates
    // a deploy skew where the backend hasn't rolled out the field
    // yet, or a partial response-shape regression.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "server-1",
          personalRecords: [],
          // totalWorkoutsCompleted intentionally absent.
        },
      }),
    });

    await processSyncQueue(storage, auth, "https://api.test");
    expect(
      storage.getRecordResponse(userId)?.totalWorkoutsCompleted,
    ).toBeNull();

    // Same expectation when the field is present but null.
    storage.enqueueMutation({
      entityType: "session",
      entityId: "local-2",
      operation: "create",
      payload: {},
      endpoint: "/sessions/record",
      method: "POST",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "server-2",
          personalRecords: [],
          totalWorkoutsCompleted: null,
        },
      }),
    });
    await processSyncQueue(storage, auth, "https://api.test");
    expect(
      storage.getRecordResponse(userId)?.totalWorkoutsCompleted,
    ).toBeNull();
  });

  it("does NOT touch the record-response cache for unrelated endpoints (workouts, sets, etc.)", async () => {
    await auth.signInWithEmail("user-1@example.com", "password");
    const session = await auth.getSession();
    const userId = session.ok && session.value ? session.value.userId : "";

    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w-1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "w-1" } }),
    });

    await processSyncQueue(storage, auth, "https://api.test");
    expect(storage.getRecordResponse(userId)).toBeNull();
  });

  it("swallows a malformed /sessions/record response body without failing the queue entry", async () => {
    // The mutation already succeeded server-side (response.ok was
    // true); we just couldn't parse the body. Don't fail the queue
    // entry — the Summary screen falls back to local prediction.
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await auth.signInWithEmail("user-1@example.com", "password");
    storage.enqueueMutation({
      entityType: "session",
      entityId: "local-1",
      operation: "create",
      payload: { status: "completed" },
      endpoint: "/sessions/record",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    // Queue entry still marked completed — server accepted the POST.
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[sync] /sessions/record"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
