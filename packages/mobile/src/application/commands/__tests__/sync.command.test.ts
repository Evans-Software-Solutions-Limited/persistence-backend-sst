import { processSyncQueue } from "../sync.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type { Exercise } from "@/domain/models/exercise";

const customExercise = (id: string, name = "My Lift"): Exercise => ({
  id,
  name,
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "me",
});

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
    expect(result).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
    });
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
    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      blocked: 0,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("swaps a custom exercise's local id to the server id on create success", async () => {
    storage.saveCustomExercise(customExercise("local-abc"));
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-abc",
      operation: "create",
      payload: { name: "My Lift" },
      endpoint: "/exercises",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "server-xyz" } }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);

    // The optimistic local row is re-keyed to the server id, so a later edit
    // PATCHes the real resource instead of 404ing on /exercises/local-abc.
    expect(storage.getCachedExercise("local-abc")).toBeNull();
    expect(storage.getCachedExercise("server-xyz")?.id).toBe("server-xyz");
  });

  it("completes the create even if the response carries no usable id (no swap, no throw)", async () => {
    storage.saveCustomExercise(customExercise("local-def"));
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-def",
      operation: "create",
      payload: { name: "My Lift" },
      endpoint: "/exercises",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("not JSON");
      },
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);
    // No id to swap to → the local row is left intact for the next refresh.
    expect(storage.getCachedExercise("local-def")?.id).toBe("local-def");
  });

  it("does not swap when the create response omits a server id", async () => {
    storage.saveCustomExercise(customExercise("local-ghi"));
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-ghi",
      operation: "create",
      payload: { name: "My Lift" },
      endpoint: "/exercises",
      method: "POST",
    });

    // Well-formed JSON, but no data.id — nothing to swap to.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);
    expect(storage.getCachedExercise("local-ghi")?.id).toBe("local-ghi");
  });

  it("does not swap a non-create exercise mutation (e.g. an edit PATCH)", async () => {
    storage.saveCustomExercise(customExercise("server-1", "Renamed"));
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "server-1",
      operation: "update",
      payload: { name: "Renamed" },
      endpoint: "/exercises/server-1",
      method: "PATCH",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "server-1" } }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);
    // Row untouched — the create-only swap branch must not fire for a PATCH.
    expect(storage.getCachedExercise("server-1")?.name).toBe("Renamed");
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
    expect(result).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
      blocked: 0,
    });

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
    expect(result).toEqual({
      processed: 2,
      succeeded: 2,
      failed: 0,
      blocked: 0,
    });
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
          workoutsThisMonth: 12,
        },
      }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      blocked: 0,
    });

    // Cache slot populated with the augmented response.
    const cached = storage.getRecordResponse(userId);
    expect(cached).not.toBeNull();
    expect(cached?.localSessionId).toBe("local-1");
    expect(cached?.workoutsThisMonth).toBe(12);
    expect(cached?.personalRecords).toHaveLength(1);
    expect(cached?.personalRecords[0]?.previousValue).toBe(120);
    expect(cached?.personalRecords[0]?.newValue).toBe(137.4);
  });

  it("caches workoutsThisMonth=null (not 0) when the server response omits or nulls the field (Inspector Brad PR #62 regression)", async () => {
    // The medium-severity "fabricated zero" bug: pre-fix, `?? 0`
    // landed a literal 0 in the cache when the field was missing.
    // The Summary screen would then render "You've completed 0
    // workouts this month" immediately after the user finished a
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

    // Response body OMITS workoutsThisMonth entirely — simulates
    // a deploy skew where the backend hasn't rolled out the field
    // yet, or a partial response-shape regression.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "server-1",
          personalRecords: [],
          // workoutsThisMonth intentionally absent.
        },
      }),
    });

    await processSyncQueue(storage, auth, "https://api.test");
    expect(storage.getRecordResponse(userId)?.workoutsThisMonth).toBeNull();

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
          workoutsThisMonth: null,
        },
      }),
    });
    await processSyncQueue(storage, auth, "https://api.test");
    expect(storage.getRecordResponse(userId)?.workoutsThisMonth).toBeNull();
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
    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      blocked: 0,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[sync] /sessions/record"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("skips entries another concurrent drain has already claimed (Inspector Brad PR #62 race fix)", async () => {
    // Two drains race for the same queue. Drain A claims and is
    // mid-fetch when Drain B picks up the same entries from its
    // own `getPendingMutations()` snapshot. With the row-conditional
    // `markMutationInFlight`, Drain B's claim returns false, the
    // entry is skipped, and the POST fires exactly once. Pre-fix,
    // the unconditional UPDATE let both drains process the same
    // entry → duplicate POSTs → duplicate session rows server-side
    // (`recordSession` has no idempotency key).
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w-1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });

    // Simulate Drain A having already claimed the entry — we just
    // flip its status manually rather than racing two real drains
    // (deterministic + faster).
    const entries = storage.getPendingMutations();
    expect(entries).toHaveLength(1);
    const claimed = storage.markMutationInFlight(entries[0].id);
    expect(claimed).toBe(true);
    // Second claim of the SAME entry must return false — this is
    // what stops Drain B from re-firing the POST.
    expect(storage.markMutationInFlight(entries[0].id)).toBe(false);

    // Drain B runs now and must NOT fire a fetch for the
    // already-claimed entry.
    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(mockFetch).not.toHaveBeenCalled();
    // Drain B's processed count reflects entries IT owned — 0
    // here, since Drain A owns the only entry.
    expect(result).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
    });
  });

  it("a claimed-then-failed entry can be re-claimed on the next drain (retry path stays open)", async () => {
    // The conditional claim allows `pending` OR `failed` — so a
    // first drain that fails the fetch leaves the entry in a
    // re-claimable state for the next drain. Without `failed` in
    // the WHERE clause, retries would be silently stuck in_flight
    // forever.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w-1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const first = await processSyncQueue(storage, auth, "https://api.test");
    expect(first).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
      blocked: 0,
    });

    // Entry is now `failed` — second drain must pick it up again.
    const second = await processSyncQueue(storage, auth, "https://api.test");
    expect(second).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      blocked: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // -- M10.6: 402 + ENTITLEMENT_DENIED handling --

  it("marks entries blocked_entitlement on 402 + ENTITLEMENT_DENIED and continues the drain (AC 12.1)", async () => {
    // Two entries — first hits 402 with a structured entitlement body,
    // second succeeds. The blocked entry must not abort the loop; the
    // second POST must still fire and land.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w-blocked",
      operation: "create",
      payload: { name: "Over-limit workout" },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "session",
      entityId: "s-ok",
      operation: "update",
      payload: { status: "completed" },
      endpoint: "/sessions/s-ok",
      method: "PATCH",
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: async () =>
          JSON.stringify({
            code: "ENTITLEMENT_DENIED",
            error: "Subscription does not include this feature",
            feature: "create_workout",
            current_tier: "premium",
            upgrade_to: "premium",
            upgrade_price_monthly: 12.99,
          }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({
      processed: 2,
      succeeded: 1,
      failed: 0,
      blocked: 1,
    });

    // The blocked entry now sits in `blocked_entitlement` with its
    // verdict captured. It is NOT in `getPendingMutations` — the
    // worker won't retry on the next drain.
    const blockedEntries = storage.getBlockedEntries();
    expect(blockedEntries).toHaveLength(1);
    expect(blockedEntries[0].entityId).toBe("w-blocked");
    expect(blockedEntries[0].entitlementVerdict).toEqual(
      expect.objectContaining({
        feature: "create_workout",
        currentTier: "premium",
        upgradeTo: "premium",
        upgradePriceMonthly: 12.99,
        blockedAt: expect.any(String),
      }),
    );
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getSyncStats().blocked).toBe(1);
  });

  it("falls through to the generic failed path on 402 with a malformed body (AC 12.6)", async () => {
    // 402 status BUT the body isn't a recognisable ENTITLEMENT_DENIED
    // envelope — we never fabricate a verdict from a partial parse.
    // Entry must end up in `failed`, not `blocked_entitlement`.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w-1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "<html>Payment Required</html>",
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
      blocked: 0,
    });
    expect(storage.getBlockedEntries()).toHaveLength(0);
    expect(storage.getSyncStats().failed).toBe(1);
  });

  it("non-402 errors are never classified as blocked_entitlement (AC 12.6)", async () => {
    // 5xx → failed. Validation 400 → failed. None of them touch the
    // blocked pool.
    for (const status of [400, 500, 503]) {
      storage.enqueueMutation({
        entityType: "workout",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => `HTTP ${status}`,
      });
    }
    await processSyncQueue(storage, auth, "https://api.test");
    expect(storage.getBlockedEntries()).toHaveLength(0);
    expect(storage.getSyncStats().failed).toBeGreaterThan(0);
  });

  it("blocked entries are skipped on subsequent flushes (AC 12.2)", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () =>
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          feature: "create_workout",
          current_tier: "free",
          upgrade_to: "premium",
          upgrade_price_monthly: 4.99,
        }),
    });
    await processSyncQueue(storage, auth, "https://api.test");
    expect(storage.getSyncStats().blocked).toBe(1);

    // Second drain — must not see the blocked entry. fetch is not
    // called again.
    mockFetch.mockReset();
    const second = await processSyncQueue(storage, auth, "https://api.test");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(second).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
    });
  });

  it("unblocked entry re-enters the queue and re-fires the POST (path is reversible)", async () => {
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () =>
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          feature: "create_workout",
          current_tier: "premium",
          upgrade_to: "premium",
          upgrade_price_monthly: 12.99,
        }),
    });
    await processSyncQueue(storage, auth, "https://api.test");
    const blockedEntries = storage.getBlockedEntries();
    expect(blockedEntries).toHaveLength(1);

    storage.unblockEntries([blockedEntries[0].id]);
    expect(storage.getBlockedEntries()).toHaveLength(0);
    expect(storage.getPendingMutations()).toHaveLength(1);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      blocked: 0,
    });
  });
});
