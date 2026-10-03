import { act, renderHook } from "@testing-library/react-native";
import { useActiveSession } from "../useActiveSession";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";

const mockStorage = new InMemoryStorageAdapter();
let mockAccount: string | null = "u";
let mockListener: (() => void) | undefined;
const mockUnsubscribe = jest.fn();
const mockSubscribe = jest.fn((listener: () => void) => {
  mockListener = listener;
  return mockUnsubscribe;
});
let mockLobby: { workout: { subscribe: typeof mockSubscribe } } | undefined;
jest.mock("../useAdapters", () => ({
  useAdapters: () => ({ storage: mockStorage, togetherLobby: mockLobby }),
}));
jest.mock("../useAuth", () => ({
  useAuth: () => ({ session: mockAccount ? { userId: mockAccount } : null }),
}));
const draft: WorkoutSession = {
  id: "local-1",
  userId: "u",
  workoutId: null,
  name: "Personal",
  status: "in_progress",
  startedAt: "2026-10-04T10:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = "u";
  mockLobby = { workout: { subscribe: mockSubscribe } };
  mockStorage.cacheActiveSession("u", draft);
});
it("rereads authoritative snapshots on promotion and receipt changes and unsubscribes", () => {
  const { result, unmount } = renderHook(() => useActiveSession());
  expect(result.current.session?.name).toBe("Personal");
  act(() => {
    mockStorage.cacheActiveSession("u", {
      ...draft,
      together: { sessionId: "shared", executionId: "own" },
    });
    mockListener!();
  });
  expect(result.current.session?.together?.executionId).toBe("own");
  unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});
it("keeps personal manual rereads working without capability and isolates account changes", () => {
  mockLobby = undefined;
  const { result, rerender } = renderHook(() => useActiveSession());
  act(() => {
    mockStorage.cacheActiveSession("u", { ...draft, notes: "new" });
    result.current.rereadCache();
  });
  expect(result.current.session?.notes).toBe("new");
  mockAccount = null;
  rerender({});
  expect(result.current.session).toBeNull();
  expect(result.current.userId).toBeNull();
  expect(mockSubscribe).not.toHaveBeenCalled();
});
