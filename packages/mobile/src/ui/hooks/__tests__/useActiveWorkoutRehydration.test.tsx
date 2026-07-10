import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { WorkoutSession } from "@/domain/models/session";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useActiveWorkout } from "@/state/active-workout";
import {
  formatStartedAt,
  useActiveWorkoutRehydration,
  type UseActiveWorkoutRehydrationOptions,
} from "@/ui/hooks/useActiveWorkoutRehydration";

/**
 * useActiveWorkoutRehydration tests — launch reconciliation between the
 * AsyncStorage-backed slice and the SQLite existence authority.
 *
 * Spec: specs/05-active-session/requirements.md STORY-007 (AC 7.2, 7.3, 7.5)
 *       tasks.md T-05.1.4 / T-05.1.5
 */

const USER = "u-1";
const STORAGE_KEY = "persistence.activeWorkout";
const mockGetItem = AsyncStorage.getItem as jest.Mock;

function makeAdapters() {
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage, auth };
}

function signIn(auth: InMemoryAuthAdapter) {
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: USER,
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: "local-abc",
    userId: USER,
    workoutId: "w-1",
    name: "Upper Body",
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    exercises: [],
    notes: null,
    ...overrides,
  };
}

function wrapper(adapters: Adapters) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

function render(
  adapters: Adapters,
  options: UseActiveWorkoutRehydrationOptions = {},
) {
  return renderHook(() => useActiveWorkoutRehydration(options), {
    wrapper: wrapper(adapters),
  });
}

beforeEach(() => {
  useActiveWorkout.setState({ active: null, expanded: false });
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
});

it("no signed-in user → no-op (no prompt, slice untouched)", async () => {
  const { adapters } = makeAdapters(); // not signed in
  const confirm = jest.fn();
  render(adapters, { confirm });

  await waitFor(() => {
    // useAuth resolves null; give the effect a chance — it must NOT prompt.
    expect(confirm).not.toHaveBeenCalled();
  });
  expect(useActiveWorkout.getState().active).toBeNull();
});

it("callable with no options argument (default param) — signed out no-op", async () => {
  const { adapters } = makeAdapters(); // not signed in
  renderHook(() => useActiveWorkoutRehydration(), {
    wrapper: wrapper(adapters),
  });
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).toBeNull();
  });
});

it("signed in with nothing stored or live → no adopt, no prompt", async () => {
  const { adapters, auth } = makeAdapters();
  signIn(auth);
  // AsyncStorage empty (default null) + SQLite empty.
  const confirm = jest.fn();
  render(adapters, { confirm });

  await waitFor(() => {
    expect(confirm).not.toHaveBeenCalled();
  });
  expect(useActiveWorkout.getState().active).toBeNull();
});

it("does not re-run for the same user when a dependency changes identity", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { rerender } = renderHook(
    ({ confirm }: { confirm: UseActiveWorkoutRehydrationOptions["confirm"] }) =>
      useActiveWorkoutRehydration({ confirm }),
    { wrapper: wrapper(adapters), initialProps: { confirm: jest.fn() } },
  );
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).not.toBeNull();
  });
  const callsAfterFirst = mockGetItem.mock.calls.length;
  // New confirm identity re-fires the effect; the ran-once guard short-circuits.
  rerender({ confirm: jest.fn() });
  rerender({ confirm: jest.fn() });
  expect(mockGetItem.mock.calls.length).toBe(callsAfterFirst);
});

it("orphan pointer (stored, but SQLite has no live session) → cleared", async () => {
  const { adapters, auth } = makeAdapters();
  signIn(auth);
  // AsyncStorage has a fresh pointer; SQLite has nothing.
  const pointer = {
    sessionId: "local-gone",
    workoutId: "w-1",
    name: "Ghost",
    startedAt: new Date().toISOString(),
  };
  mockGetItem.mockResolvedValue(JSON.stringify({ v: 1, pointer }));

  const confirm = jest.fn();
  render(adapters, { confirm });

  await waitFor(() => {
    expect(useActiveWorkout.getState().active).toBeNull();
  });
  expect(confirm).not.toHaveBeenCalled();
});

it("stored pointer mismatches the live session id → adopts the live one", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const session = makeSession({ id: "local-new" });
  storage.cacheActiveSession(USER, session);
  // AsyncStorage holds a pointer for a DIFFERENT (stale) session id.
  mockGetItem.mockResolvedValue(
    JSON.stringify({
      v: 1,
      pointer: {
        sessionId: "local-old",
        workoutId: "w-1",
        name: "Stale",
        startedAt: new Date().toISOString(),
      },
    }),
  );

  render(adapters, { confirm: jest.fn() });

  await waitFor(() => {
    expect(useActiveWorkout.getState().active?.sessionId).toBe("local-new");
  });
});

it("SQLite has a live session the slice missed → adopted minimised", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const session = makeSession();
  storage.cacheActiveSession(USER, session);
  // AsyncStorage empty (default null) — pre-05 session.

  const confirm = jest.fn();
  render(adapters, { confirm });

  await waitFor(() => {
    expect(useActiveWorkout.getState().active?.sessionId).toBe(session.id);
  });
  expect(useActiveWorkout.getState().expanded).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

it("coach Start-live: adopting a live session from SQLite preserves withClient (no misattribution after force-quit)", async () => {
  // Inspector Brad M18 regression: the coach's on-behalf context is persisted
  // on the SQLite session, so a rehydrate that reconstructs the pointer from
  // SQLite (AsyncStorage pointer lost to a force-quit) must recover withClient —
  // otherwise the client's session would flush to the coach's own history.
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const session = makeSession({
    withClient: { id: "client-9", name: "Jordan", initials: "JB" },
  });
  storage.cacheActiveSession(USER, session);
  // AsyncStorage empty (default null) — the pointer was lost.

  render(adapters, { confirm: jest.fn() });

  await waitFor(() => {
    expect(useActiveWorkout.getState().active?.sessionId).toBe(session.id);
  });
  expect(useActiveWorkout.getState().active?.withClient).toEqual({
    id: "client-9",
    name: "Jordan",
    initials: "JB",
  });
});

it("fresh live session matching the stored pointer → kept, no prompt", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const session = makeSession();
  storage.cacheActiveSession(USER, session);
  mockGetItem.mockResolvedValue(
    JSON.stringify({
      v: 1,
      pointer: {
        sessionId: session.id,
        workoutId: session.workoutId,
        name: session.name,
        startedAt: session.startedAt,
      },
    }),
  );

  const confirm = jest.fn();
  render(adapters, { confirm });

  await waitFor(() => {
    expect(useActiveWorkout.getState().active?.sessionId).toBe(session.id);
  });
  expect(confirm).not.toHaveBeenCalled();
});

it("stale live session (>24h) → prompts; discard cancels + clears", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const session = makeSession({ startedAt: old });
  storage.cacheActiveSession(USER, session);

  // confirm immediately discards.
  const confirm = jest.fn((args: { onDiscard: () => void }) =>
    args.onDiscard(),
  );
  render(adapters, { confirm });

  await waitFor(() => {
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  expect(confirm.mock.calls[0][0]).toEqual(
    expect.objectContaining({ name: "Upper Body", startedAt: old }),
  );
  // Discard cleared the UI state + finalized the SQLite session.
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).toBeNull();
  });
  expect(storage.getActiveSession(USER)).toBeNull();
});

it("stale live session → resume keeps it minimised", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const session = makeSession({ startedAt: old });
  storage.cacheActiveSession(USER, session);

  const confirm = jest.fn((args: { onResume: () => void }) => args.onResume());
  render(adapters, { confirm });

  await waitFor(() => {
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  expect(useActiveWorkout.getState().active?.sessionId).toBe(session.id);
  expect(useActiveWorkout.getState().expanded).toBe(false);
  expect(storage.getActiveSession(USER)).not.toBeNull();
});

it("runs once per user — a re-render does not re-read storage", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { rerender } = render(adapters, {});
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).not.toBeNull();
  });
  const callsAfterFirst = mockGetItem.mock.calls.length;
  rerender({});
  rerender({});
  expect(mockGetItem.mock.calls.length).toBe(callsAfterFirst);
});

it("uses the default Alert-based prompt when no confirm is injected", async () => {
  // Exercises the defaultConfirm branch (Alert.alert is globally mockable;
  // we only assert it doesn't throw and the session stays adopted).
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  storage.cacheActiveSession(USER, makeSession({ startedAt: old }));

  render(adapters, {}); // no confirm → defaultConfirm → Alert.alert
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).not.toBeNull();
  });
  void STORAGE_KEY;
});

describe("formatStartedAt", () => {
  it("renders a parseable ISO date as a friendly string", () => {
    const out = formatStartedAt("2026-06-07T10:00:00.000Z");
    expect(typeof out).toBe("string");
    expect(out).not.toBe("earlier");
  });

  it("falls back to 'earlier' for an unparseable timestamp", () => {
    expect(formatStartedAt("not-a-date")).toBe("earlier");
  });
});
