import { processSyncQueue } from "../sync.command";
import { configureHabitCommand } from "../configure-habit.command";
import { toggleHabitDayCommand } from "../toggle-habit.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type { Exercise } from "@/domain/models/exercise";

// Wed 2026-06-10 — deterministic clock for the offline configure→tap→drain
// residual-fix scenario (nextMondayISO needs a fixed "now").
const now = new Date("2026-06-10T12:00:00.000Z");

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

  it("resets the preferences cache to the server's merged column on flush", async () => {
    // optimistic value pre-flush
    storage.cacheNotificationPreferences({ goal_milestone: false });
    storage.enqueueMutation({
      entityType: "notification-preferences",
      operation: "update",
      payload: { goal_milestone: false },
      endpoint: "/notifications/preferences",
      method: "POST",
    });

    // server echoes the FULL merged column (RETURNING), reconciled
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { goal_milestone: false, workout_assigned: true },
      }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);
    expect(storage.getCachedNotificationPreferences()).toEqual({
      goal_milestone: false,
      workout_assigned: true,
    });
  });

  it("does not clobber a still-queued toggle when an earlier one flushes (Inspector #13)", async () => {
    // Two separate toggles queued (simulating one made while the first was
    // mid-flush, so they didn't coalesce). Optimistic cache has both.
    storage.cacheNotificationPreferences({
      workout_assigned: false,
      goal_milestone: false,
    });
    storage.enqueueMutation({
      entityType: "notification-preferences",
      operation: "update",
      payload: { workout_assigned: false },
      endpoint: "/notifications/preferences",
      method: "POST",
    });
    storage.enqueueMutation({
      entityType: "notification-preferences",
      operation: "update",
      payload: { goal_milestone: false },
      endpoint: "/notifications/preferences",
      method: "POST",
    });

    // Only the FIRST POST gets a response; its merged column doesn't yet
    // reflect the second toggle (still queued).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { workout_assigned: false } }),
    });

    await processSyncQueue(storage, auth, "https://api.test");

    // The second toggle's optimistic value survives the first's capture.
    expect(storage.getCachedNotificationPreferences()).toMatchObject({
      workout_assigned: false,
      goal_milestone: false,
    });
  });

  it("keeps the optimistic preferences value when the response carries no data", async () => {
    storage.cacheNotificationPreferences({ goal_milestone: false });
    storage.enqueueMutation({
      entityType: "notification-preferences",
      operation: "update",
      payload: { goal_milestone: false },
      endpoint: "/notifications/preferences",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // no `data` key
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(1);
    expect(storage.getCachedNotificationPreferences()).toEqual({
      goal_milestone: false,
    });
  });

  it("keeps the optimistic preferences value if the response capture fails", async () => {
    storage.cacheNotificationPreferences({ goal_milestone: false });
    storage.enqueueMutation({
      entityType: "notification-preferences",
      operation: "update",
      payload: { goal_milestone: false },
      endpoint: "/notifications/preferences",
      method: "POST",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    // POST succeeded → entry completes; cache keeps its optimistic value
    expect(result.succeeded).toBe(1);
    expect(storage.getCachedNotificationPreferences()).toEqual({
      goal_milestone: false,
    });
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

  it("swaps a nutrition entry's local id on create success: re-keys the cached day + re-points a queued delete (in-flight-create race)", async () => {
    const date = "2026-06-10";
    const localId = "local-nabc";
    const serverId = "server-nxyz";
    storage.cacheFuelToday("u1", date, {
      date,
      targets: null,
      consumed: { kcal: 90, proteinG: 1, carbsG: 23, fatG: 0, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [
          {
            id: localId,
            userId: "u1",
            foodId: null,
            recipeId: null,
            mealId: null,
            mealSlot: "breakfast",
            servings: 1,
            kcal: 90,
            proteinG: 1,
            carbsG: 23,
            fatG: 0,
            loggedAt: `${date}T12:00:00.000Z`,
            loggedByUserId: null,
            aiEstimated: false,
            aiConfidence: null,
            customName: "Banana",
          },
        ],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    storage.enqueueMutation({
      entityType: "nutrition_entry",
      entityId: localId,
      operation: "create",
      payload: { customName: "Banana" },
      endpoint: "/nutrition/entries",
      method: "POST",
    });
    // A swipe-delete queued against the local id while the create was in flight.
    storage.enqueueMutation({
      entityType: "nutrition_entry",
      entityId: localId,
      operation: "delete",
      payload: {},
      endpoint: `/nutrition/entries/${localId}`,
      method: "DELETE",
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: serverId } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: serverId, deleted: true } }),
      });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result.succeeded).toBe(2);
    // The cached entry is re-keyed to the server id…
    expect(
      storage.getCachedFuelToday("u1", date)?.entriesBySlot.breakfast[0]?.id,
    ).toBe(serverId);
    // …and the queued DELETE is re-pointed to the REAL id, never the doomed
    // local one. NOTE: this drain sends the DELETE to serverId because the
    // in-memory adapter's getPendingMutations returns live object references, so
    // the swap's endpoint rewrite is seen by the already-snapshotted entry. In
    // production (SQLite returns fresh row copies) a same-drain DELETE would 404
    // once against the local id, but the swap has ALREADY corrected the DB row's
    // endpoint, so the next drain retries against serverId and succeeds — no
    // permanent orphan either way. This asserts the swap re-points the queued
    // mutation + re-keys the cache; the cross-drain self-heal is inherent.
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.test/nutrition/entries/${serverId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mockFetch).not.toHaveBeenCalledWith(
      `https://api.test/nutrition/entries/${localId}`,
      expect.anything(),
    );
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

  it("18-habit-setup: a flushed SELF habit_config PUT swaps the optimistic local- goalId for the server one", async () => {
    // Optimistic first-enable wrote a local- goalId into the config cache.
    storage.upsertHabitConfig("u1", {
      category: "water",
      enabled: true,
      goalId: "local-abc",
      assignedByCoach: false,
      locked: false,
      targetValue: 2,
      unit: "l",
      period: "daily",
      completionRule: "value_gte",
      daysPerWeek: 5,
      tolerancePct: null,
      pending: null,
    });
    storage.enqueueMutation({
      entityType: "habit_config",
      entityId: "u1:water",
      operation: "update",
      payload: { targetValue: 2, daysPerWeek: 5 },
      endpoint: "/users/me/habits/water/config",
      method: "PUT",
    });

    // The PUT echoes the server config with the REAL goalId.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          category: "water",
          enabled: true,
          goalId: "server-goal-xyz",
          assignedByCoach: false,
          locked: false,
          targetValue: 2,
          unit: "l",
          period: "daily",
          completionRule: "value_gte",
          daysPerWeek: 5,
          tolerancePct: null,
          pending: null,
        },
      }),
    });

    await processSyncQueue(storage, auth, "https://api.test");

    const cached = storage.getHabitConfigs("u1");
    expect(cached).toHaveLength(1); // de-duped on category
    expect(cached[0].goalId).toBe("server-goal-xyz");
  });

  it("residual fix: airplane-mode configure-Water → tap today → drain swaps the local goalId onto the QUEUED completion POST + re-keys the cache", async () => {
    // Airplane mode: configure Water (offline first-enable → local- goalId),
    // then immediately tap today's grid cell — BOTH enqueue independently and
    // neither has drained yet.
    configureHabitCommand(
      { storage, userId: "u1", idFactory: () => "abc", now: () => now },
      { category: "water", targetValue: 2, daysPerWeek: 5 },
    );
    const localGoalId = storage.getHabitConfigs("u1")[0].goalId!;
    expect(localGoalId).toBe("local-abc");

    toggleHabitDayCommand(
      { storage, userId: "u1", idFactory: () => "def" },
      { goalId: localGoalId, day: "2026-06-10", done: true, value: 2 },
    );

    // Sanity: the completion cache + queue are seeded under the LOCAL id
    // before the drain runs.
    expect(
      storage.getCachedHabitCompletions("u1", { goalId: localGoalId }),
    ).toHaveLength(1);
    const preDrainQueue = storage.getPendingMutations();
    expect(preDrainQueue).toHaveLength(2); // config PUT + completion POST
    expect(
      (JSON.parse(preDrainQueue[1].payload) as { goalId: string }).goalId,
    ).toBe(localGoalId);

    // Connectivity restored: the drain flushes BOTH queued mutations, FIFO.
    // 1) the config PUT — echoes the server's real goalId.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          category: "water",
          enabled: true,
          goalId: "server-goal-water",
          assignedByCoach: false,
          locked: false,
          targetValue: 2,
          unit: "l",
          period: "daily",
          completionRule: "value_gte",
          daysPerWeek: 5,
          tolerancePct: null,
          pending: null,
        },
      }),
    });
    // 2) the completion POST — succeeds now that its payload carries the
    // real goalId (the config-PUT reconcile rewrote it in-flight).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "completion-1" } }),
    });

    const result = await processSyncQueue(storage, auth, "https://api.test");
    expect(result).toEqual({
      processed: 2,
      succeeded: 2,
      failed: 0,
      blocked: 0,
    });

    // The completion POST that actually went out over the wire carried the
    // SERVER goalId, not the stale local one.
    const completionCall = mockFetch.mock.calls[1];
    expect(completionCall[0]).toBe("https://api.test/habit-completions");
    const sentBody = JSON.parse(
      (completionCall[1] as { body: string }).body,
    ) as { goalId: string };
    expect(sentBody.goalId).toBe("server-goal-water");

    // The cache row is re-keyed too — no stale row lingers under the local
    // id, and the real one is queryable by the server goalId.
    expect(
      storage.getCachedHabitCompletions("u1", { goalId: localGoalId }),
    ).toHaveLength(0);
    const rekeyed = storage.getCachedHabitCompletions("u1", {
      goalId: "server-goal-water",
    });
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0].value).toBe(2);
  });

  it("residual fix: the reconcile also rewrites a queued DELETE's payload AND its query-string endpoint", async () => {
    configureHabitCommand(
      { storage, userId: "u1", idFactory: () => "abc", now: () => now },
      { category: "water", targetValue: 2, daysPerWeek: 5 },
    );
    const localGoalId = storage.getHabitConfigs("u1")[0].goalId!;

    // Tap on, then immediately tap off (un-toggle) before the drain — the
    // optimistic cache never sees the "on" state land, but the DELETE is
    // still queued (mirrors a fast double-tap while offline).
    toggleHabitDayCommand(
      { storage, userId: "u1", idFactory: () => "def" },
      { goalId: localGoalId, day: "2026-06-10", done: false },
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          category: "water",
          enabled: true,
          goalId: "server-goal-water",
          assignedByCoach: false,
          locked: false,
          targetValue: 2,
          unit: "l",
          period: "daily",
          completionRule: "value_gte",
          daysPerWeek: 5,
          tolerancePct: null,
          pending: null,
        },
      }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await processSyncQueue(storage, auth, "https://api.test");

    const deleteCall = mockFetch.mock.calls[1];
    expect(deleteCall[0]).toBe(
      "https://api.test/habit-completions?goalId=server-goal-water&date=2026-06-10",
    );
  });

  it("18-habit-setup: a COACH habit_config PUT does NOT mutate any local config cache", async () => {
    storage.enqueueMutation({
      entityType: "habit_config",
      entityId: "client-9:water",
      operation: "update",
      payload: { targetValue: 2 },
      endpoint: "/trainers/me/clients/client-9/habits/water/config",
      method: "PUT",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { category: "water", goalId: "g" } }),
    });

    await processSyncQueue(storage, auth, "https://api.test");
    // The reconcile only fires for `/users/me/habits/...` (self); a coach write
    // targets the client's data, which the coach device never caches.
    expect(storage.getHabitConfigs("client-9")).toHaveLength(0);
  });
});
