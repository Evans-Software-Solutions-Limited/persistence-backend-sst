import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import * as syncCommandModule from "@/application/commands/sync.command";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  SYNC_RECONNECT_DEBOUNCE_MS,
  useSyncWorker,
} from "@/ui/hooks/useSyncWorker";

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeAdapters(
  storage: InMemoryStorageAdapter,
  auth: InMemoryAuthAdapter,
  session: AuthSession | null,
  netInfo: InMemoryNetInfoAdapter = new InMemoryNetInfoAdapter(),
): Adapters {
  const wrappedAuth = {
    ...auth,
    // Fire the auth-state callback synchronously at registration —
    // see SwapExercisePopover.test.tsx for the full rationale (CI
    // flake from deferred-via-setTimeout setState racing with test-
    // library polling).
    onAuthStateChange: (cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    },
    getSession: jest.fn(async () => ok(session)),
    getAccessToken: jest.fn(async () => "test-token"),
  } as unknown as Adapters["auth"];
  return {
    api: new InMemoryApiAdapter(),
    auth: wrappedAuth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo,
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const session: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

describe("useSyncWorker", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does NOT flush when there is no session", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, null);

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("flushes the queue once on mount when authenticated", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("re-flushes when AppState transitions to active", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    // Capture the AppState listener so we can trigger it.
    let activeListener: ((s: string) => void) | null = null;
    const addEventSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event, cb) => {
        if (event === "change") {
          activeListener = cb as (s: string) => void;
        }
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    // Mount-flush completes (queue empty here, so 0 fetches).
    await waitFor(() => expect(addEventSpy).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledTimes(0);

    // Enqueue then simulate foreground.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w2",
      operation: "create",
      payload: { name: "Pull Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    activeListener!("active");

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it("does not double-flush when triggered concurrently", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    // Hold the first fetch open so the second mount fires while it's
    // still in flight.
    let resolveFirst: (() => void) | null = null;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true, json: async () => ({}) });
        }),
    );
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    let activeListener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, cb) => {
      if (event === "change") activeListener = cb as (s: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    // Trigger a foreground transition before the mount-flush settles.
    await waitFor(() => expect(activeListener).not.toBeNull());
    activeListener!("active");

    // Resolve the first flush so reentrancy clears.
    resolveFirst!();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  // ── M13 sync-hardening — flush coalescing (do/while reflush loop) ─────────
  it("coalesces a concurrent flush request into ONE additional processSyncQueue pass", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });

    // Hold the mount-flush's fetch open so a concurrent trigger arrives
    // while pass #1 is still draining.
    let resolveFirst: (() => void) | null = null;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true, json: async () => ({}) });
        }),
    );
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);
    const processSpy = jest.spyOn(syncCommandModule, "processSyncQueue");

    let activeListener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, cb) => {
      if (event === "change") activeListener = cb as (s: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    // Mount-flush starts pass #1 (its fetch is held open).
    await waitFor(() => expect(processSpy).toHaveBeenCalledTimes(1));

    // A second flush request arrives WHILE pass #1 is still in flight —
    // pre-M13 this was a plain no-op; now it must be recorded and re-run
    // once pass #1 finishes (so a just-resurrected entry isn't stranded
    // until the next foreground/reconnect trigger).
    activeListener!("active");

    // Let pass #1 complete.
    resolveFirst!();

    // Pass #2 runs automatically — the queue is empty by the time it
    // runs (the one entry already completed in pass #1), so it fires no
    // additional fetch; the assertion is on the processSyncQueue call
    // count, not on fetch.
    await waitFor(() => expect(processSpy).toHaveBeenCalledTimes(2));
    // Only one HTTP request was ever needed for the one queued entry.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("with no concurrent trigger, flush runs processSyncQueue exactly once (no infinite reflush loop)", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);
    const processSpy = jest.spyOn(syncCommandModule, "processSyncQueue");

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    await waitFor(() => expect(processSpy).toHaveBeenCalledTimes(1));
    // Give the do/while loop room to spin again if it incorrectly looped
    // — `reflushRef` was never set, so it must not.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processSpy).toHaveBeenCalledTimes(1);
  });

  // ── M13 sync-hardening — reconnect-triggered resurrect + flush ────────────
  describe("NetInfo reconnect (M13 sync-hardening)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    /** Let the mount-flush + the isConnected() probe settle before toggling. */
    async function settleMount() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    it("does NOT flush on a non-active AppState transition (e.g. background)", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      let listener: ((s: string) => void) | null = null;
      jest
        .spyOn(AppState, "addEventListener")
        .mockImplementation((event, cb) => {
          if (event === "change") listener = cb as (s: string) => void;
          return { remove: jest.fn() } as unknown as ReturnType<
            typeof AppState.addEventListener
          >;
        });

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      act(() => listener!("background"));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("swallows an isConnected() probe rejection without breaking subsequent reconnect handling", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      jest
        .spyOn(netInfo, "isConnected")
        .mockRejectedValue(new Error("probe failed"));
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      // The subscribe stream still drives reconnect handling correctly
      // even though the probe rejected — its first callback seeds the
      // ref (prev was still null, since the rejected probe never set it).
      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    it("a late-resolving probe does NOT clobber a fresher value the subscribe stream already produced", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      let resolveProbe: ((connected: boolean) => void) | null = null;
      jest.spyOn(netInfo, "isConnected").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
      );
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      // Mount-flush settles, but the probe is still pending.
      await act(async () => {
        await Promise.resolve();
      });

      // The subscribe stream fires FIRST (seeds prev=false), before the
      // probe resolves.
      act(() => netInfo.setConnected(false));

      // NOW the stale probe resolves with a DIFFERENT value (true). The
      // `subscribeFired` guard must stop it from overwriting the ref.
      await act(async () => {
        resolveProbe!(true);
        await Promise.resolve();
      });

      mockFetch.mockClear();
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      // If the stale probe HAD clobbered the ref to `true`, this
      // setConnected(true) would look like a no-op repeat (true → true)
      // and never fire. Because the guard held, the ref is still `false`
      // from the subscribe stream, so this is a genuine false→true
      // transition.
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    it("triggers a flush on a false→true reconnect transition, without an AppState event", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      // Enqueue AFTER mount so only the reconnect flush (not the mount
      // flush) can be responsible for sending it.
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test/workouts",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("does NOT flush on a true→false (going offline) transition", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      act(() => netInfo.setConnected(false));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resets exhausted entries ONCE on reconnect, then drains them", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      storage.enqueueMutation({
        entityType: "session",
        entityId: "s1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/sessions/record",
        method: "POST",
      });
      const entryId = storage.getPendingMutations()[0].id;
      // Simulate 3 prior offline-caused failures — exhausts the retry
      // budget, which strands the entry (invisible to getPendingMutations
      // forever, pre-M13).
      storage.markMutationFailed(entryId, "e1");
      storage.markMutationFailed(entryId, "e2");
      storage.markMutationFailed(entryId, "e3");
      expect(storage.getFailedExhaustedEntries()).toHaveLength(1);
      expect(storage.getPendingMutations()).toHaveLength(0);

      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test/sessions/record",
        expect.objectContaining({ method: "POST" }),
      );
      // Reset + successful drain — no longer exhausted, no longer pending.
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
      expect(storage.getPendingMutations()).toHaveLength(0);
    });

    it("resurrects an exhausted ON-BEHALF session-record entry (coach Start-live) on reconnect", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      storage.enqueueMutation({
        entityType: "session",
        entityId: "s1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/trainers/me/clients/client-9/sessions/record",
        method: "POST",
      });
      const entryId = storage.getPendingMutations()[0].id;
      storage.markMutationFailed(entryId, "e1");
      storage.markMutationFailed(entryId, "e2");
      storage.markMutationFailed(entryId, "e3");
      expect(storage.getFailedExhaustedEntries()).toHaveLength(1);

      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test/trainers/me/clients/client-9/sessions/record",
        expect.objectContaining({ method: "POST" }),
      );
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
    });

    it("does NOT resurrect an exhausted NON-session entry on reconnect — resetFailedEntries only touches the session id", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();

      // An exhausted session-record entry (idempotent — should resurrect)…
      storage.enqueueMutation({
        entityType: "session",
        entityId: "s1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/sessions/record",
        method: "POST",
      });
      const sessionEntryId = storage.getPendingMutations().slice(-1)[0].id;
      storage.markMutationFailed(sessionEntryId, "e1");
      storage.markMutationFailed(sessionEntryId, "e2");
      storage.markMutationFailed(sessionEntryId, "e3");

      // …alongside an exhausted NON-session create (no idempotency key —
      // must NOT be auto-resurrected; duplicate-POST risk).
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });
      const workoutEntryId = storage.getPendingMutations().slice(-1)[0].id;
      storage.markMutationFailed(workoutEntryId, "e1");
      storage.markMutationFailed(workoutEntryId, "e2");
      storage.markMutationFailed(workoutEntryId, "e3");

      expect(storage.getFailedExhaustedEntries()).toHaveLength(2);

      const resetSpy = jest.spyOn(storage, "resetFailedEntries");
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      // Only the session-record id was reset — the workout id was never
      // passed to resetFailedEntries.
      await waitFor(() =>
        expect(resetSpy).toHaveBeenCalledWith([sessionEntryId]),
      );
      // Only the resurrected session mutation was ever sent.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test/sessions/record",
        expect.objectContaining({ method: "POST" }),
      );
      // The workout entry is untouched — still failed-exhausted, ready
      // for an explicit Retry on /sync-failed.
      const stillExhausted = storage.getFailedExhaustedEntries();
      expect(stillExhausted).toHaveLength(1);
      expect(stillExhausted[0].id).toBe(workoutEntryId);
    });

    it("debounces rapid toggles — only flushes once for a burst of transitions", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      // A burst: offline/online flip-flop twice in quick succession, each
      // well inside the debounce window.
      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true)); // transition #1 — starts the timer
      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true)); // transition #2 — resets the timer

      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      // Give any (incorrect) second-fire timer a chance to land.
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("a persistently-failing mutation re-exhausts on later drains instead of resurrecting in a loop", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      storage.enqueueMutation({
        entityType: "session",
        entityId: "s1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/sessions/record",
        method: "POST",
      });
      const entryId = storage.getPendingMutations()[0].id;
      storage.markMutationFailed(entryId, "e1");
      storage.markMutationFailed(entryId, "e2");
      storage.markMutationFailed(entryId, "e3");
      expect(storage.getFailedExhaustedEntries()).toHaveLength(1);

      // The server keeps genuinely rejecting this mutation — resurrect is
      // NOT a magic fix for a real rejection, only for connectivity blips.
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      let activeListener: ((s: string) => void) | null = null;
      jest
        .spyOn(AppState, "addEventListener")
        .mockImplementation((event, cb) => {
          if (event === "change") activeListener = cb as (s: string) => void;
          return { remove: jest.fn() } as unknown as ReturnType<
            typeof AppState.addEventListener
          >;
        });

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await settleMount();
      mockFetch.mockClear();

      // Reconnect: resets the exhausted entry, then attempt #1 (post-reset)
      // fails — retry_count goes 0 → 1, NOT yet re-exhausted.
      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);

      // Two more ordinary foreground drains burn the rest of the retry
      // budget — the resurrect logic never re-fires on its own (no second
      // reconnect transition occurred), so this proves it doesn't loop.
      await act(async () => {
        activeListener!("active");
        await Promise.resolve();
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      await act(async () => {
        activeListener!("active");
        await Promise.resolve();
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      // Re-exhausted — surfaces again for the /sync-failed review UI
      // (Task 3) instead of vanishing or spinning forever.
      const exhausted = storage.getFailedExhaustedEntries();
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0].id).toBe(entryId);
    });

    it("logs and swallows an unexpected flush-level throw (shell-level failure, not a per-entry one)", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      // Simulate a shell-level failure — e.g. a corrupt DB read — that
      // `processSyncQueue` itself throws, OUTSIDE its own per-entry
      // try/catch (which only guards the fetch, not the initial read).
      jest.spyOn(storage, "getPendingMutations").mockImplementation(() => {
        throw new Error("db read failed");
      });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

      await waitFor(() =>
        expect(consoleSpy).toHaveBeenCalledWith(
          "[useSyncWorker] flush failed:",
          expect.any(Error),
        ),
      );
      consoleSpy.mockRestore();
    });

    it("logs and continues when the reconnect resurrect step itself throws", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      mockFetch.mockClear();

      // Fail ONLY the resurrect step's read — the ordinary flush right
      // after it must still run (best-effort — a resurrect bug never
      // blocks the normal drain).
      jest
        .spyOn(storage, "getFailedExhaustedEntries")
        .mockImplementation(() => {
          throw new Error("exhausted-read failed");
        });
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });

      await waitFor(() =>
        expect(consoleSpy).toHaveBeenCalledWith(
          "[useSyncWorker] reconnect resurrect failed:",
          expect.any(Error),
        ),
      );
      // The ordinary flush after the failed resurrect step still fires.
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      consoleSpy.mockRestore();
    });

    it("clears a pending debounce timer on unmount instead of firing after the effect tears down", async () => {
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const auth = new InMemoryAuthAdapter();
      const netInfo = new InMemoryNetInfoAdapter(true);
      const adapters = makeAdapters(storage, auth, session, netInfo);

      const { unmount } = renderHook(() => useSyncWorker(), {
        wrapper: wrap(adapters),
      });
      await settleMount();
      mockFetch.mockClear();

      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      // Start a reconnect transition (arms the debounce timer) then
      // unmount BEFORE it fires.
      act(() => netInfo.setConnected(false));
      act(() => netInfo.setConnected(true));
      unmount();

      // Advancing timers past the debounce window must NOT trigger the
      // resurrect+flush — the effect's cleanup cleared the pending timer.
      act(() => {
        jest.advanceTimersByTime(SYNC_RECONNECT_DEBOUNCE_MS);
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
