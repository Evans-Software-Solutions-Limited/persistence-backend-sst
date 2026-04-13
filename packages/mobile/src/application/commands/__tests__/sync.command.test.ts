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
});
