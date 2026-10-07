import { renderHook, act } from "@testing-library/react-native";
import { useTogetherEndNavigation } from "../useTogetherEndNavigation";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
const mockPush = jest.fn();
let mockFocused = true;
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (cb: () => () => void) =>
    require("react").useEffect(
      () => (mockFocused ? cb() : undefined),
      [cb, mockFocused],
    ),
}));
function setup(cloudMode = false) {
  const storage = new InMemoryStorageAdapter();
  storage.cacheActiveSession("u", {
    id: "local",
    userId: "u",
    workoutId: null,
    name: "Squats",
    status: "in_progress",
    startedAt: "2026-10-07T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
    together: {
      sessionId: "shared",
      executionId: "own",
      ...(cloudMode ? { transport: "cloud" as const } : {}),
    },
  });
  let listener = () => {};
  const closures: { mode: string; userId: string }[] = [];
  const snapshot = {
    sessionId: "shared",
    state: "active",
    participants: [{ userId: "u", status: "active" }],
  };
  const subscribe = (l: () => void) => {
    listener = l;
    return () => {
      listener = () => {};
    };
  };
  const lobby = {
    shared: { subscribe, getSnapshot: () => ({ closures }) },
  } as unknown as TogetherLobbyPort;
  const cloud = {
    subscribe,
    getSnapshot: () => ({ snapshot }),
  } as unknown as TogetherCloudPort;
  return {
    storage,
    lobby,
    cloud,
    snapshot,
    closures,
    emit: () => act(() => listener()),
  };
}
beforeEach(() => mockPush.mockClear());
it("routes each local athlete once on host finish-all, not private continuation", () => {
  const h = setup();
  const r = renderHook(() => useTogetherEndNavigation("u", h.storage, h.lobby));
  h.closures.push({ mode: "save_own", userId: "host" });
  h.emit();
  expect(mockPush).not.toHaveBeenCalled();
  h.closures.push({ mode: "finish_all", userId: "host" });
  h.emit();
  h.emit();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/(app)/session/rate",
    params: { localSessionId: "local", groupFinish: "true" },
  });
  r.unmount();
  h.emit();
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it("routes a cloud athlete after host saves their acknowledged result", () => {
  const h = setup(true);
  renderHook(() =>
    useTogetherEndNavigation("u", h.storage, undefined, h.cloud),
  );
  h.snapshot.state = "closed";
  h.emit();
  expect(mockPush).not.toHaveBeenCalled();
  h.snapshot.participants[0].status = "saved";
  h.emit();
  h.emit();
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it("never acts on another account or unrelated cloud session", () => {
  const h = setup(true);
  const r = renderHook(
    ({ user }) => useTogetherEndNavigation(user, h.storage, undefined, h.cloud),
    { initialProps: { user: "u" } },
  );
  h.snapshot.sessionId = "other";
  h.snapshot.state = "closed";
  h.snapshot.participants[0].status = "saved";
  h.emit();
  expect(mockPush).not.toHaveBeenCalled();
  r.rerender({ user: "other" });
  h.snapshot.sessionId = "shared";
  h.emit();
  expect(mockPush).not.toHaveBeenCalled();
});

it("binds shared traffic created after the guest joins and detaches old runtimes", () => {
  const h = setup();
  let notifyLobby = () => {};
  let notifyShared = () => {};
  const unsubscribe = jest.fn();
  const lobby = {
    shared: undefined,
    subscribe: (cb: () => void) => {
      notifyLobby = cb;
      return () => {};
    },
  } as unknown as TogetherLobbyPort;
  const r = renderHook(() => useTogetherEndNavigation("u", h.storage, lobby));
  Object.assign(lobby, {
    shared: {
      getSnapshot: () => ({ closures: h.closures }),
      subscribe: (cb: () => void) => {
        notifyShared = cb;
        return unsubscribe;
      },
    },
  });
  act(() => notifyLobby());
  h.closures.push({ mode: "finish_all", userId: "host" });
  act(() => notifyShared());
  expect(mockPush).toHaveBeenCalledTimes(1);
  Object.assign(lobby, { shared: undefined });
  act(() => notifyLobby());
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  r.unmount();
});

it("processes closure received while unfocused when returning without another network event", () => {
  const h = setup();
  const r = renderHook(() => useTogetherEndNavigation("u", h.storage, h.lobby));
  mockFocused = false;
  r.rerender({});
  h.closures.push({ mode: "finish_all", userId: "host" });
  h.emit();
  expect(mockPush).not.toHaveBeenCalled();
  mockFocused = true;
  r.rerender({});
  expect(mockPush).toHaveBeenCalledTimes(1);
  r.rerender({});
  expect(mockPush).toHaveBeenCalledTimes(1);
});
