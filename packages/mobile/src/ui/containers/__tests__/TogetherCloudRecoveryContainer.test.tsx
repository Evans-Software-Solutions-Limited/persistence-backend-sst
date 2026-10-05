import React from "react";
import { TogetherRecoveryPresenter } from "../../presenters/TogetherRecoveryPresenter";
import { useActiveWorkout, pointerFromSession } from "@/state/active-workout";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherCloudRecoveryContainer } from "../TogetherCloudRecoveryContainer";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  TogetherCloudPort,
  TogetherCloudState,
} from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
let mockUser: string | null = "u",
  mockMode: string | undefined;
let mockCloud: TogetherCloudPort | undefined;
let mockStorage: InMemoryStorageAdapter;
const mockBack = jest.fn(),
  mockDismiss = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ localSessionId: "local", mode: mockMode }),
  router: { back: () => mockBack(), dismissAll: () => mockDismiss() },
}));
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ togetherCloud: mockCloud, storage: mockStorage }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockUser ? { userId: mockUser } : null }),
}));
function setup() {
  mockUser = "u";
  mockMode = undefined;
  mockBack.mockReset();
  mockDismiss.mockReset();
  mockStorage = new InMemoryStorageAdapter();
  let draft: WorkoutSession = {
    id: "local",
    userId: "u",
    name: "Squats",
    workoutId: null,
    status: "in_progress",
    startedAt: "2026-10-05T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
    together: { transport: "cloud", sessionId: "s", executionId: "e" },
  };
  mockStorage.cacheActiveSession("u", draft);
  let state: TogetherCloudState = {
    phase: "active",
    requests: [],
    previous: {},
    pendingCount: 0,
    snapshot: {
      sessionId: "s",
      state: "active",
      sharingActive: true,
      continuation: null,
      hostId: "u",
      revision: 2,
      planVersion: 1,
      plan: { name: "Squats", exercises: [] },
      participants: [
        {
          userId: "u",
          status: "active",
          ownRevision: 2,
          delegationGeneration: 0,
          allowPartnerLogging: false,
          numbersAvailable: true,
          previousValuesAvailable: false,
          exerciseCatalog: {},
          execution: { exercises: [] },
        },
      ],
      completion: {
        status: "active",
        historyId: null,
        ownRevision: 2,
        recoveryMayBePending: false,
      },
    },
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const finish = jest.fn(async () => {
    draft = { ...draft, status: "completed" };
    state = {
      ...state,
      snapshot: {
        ...state.snapshot!,
        participants: [
          {
            ...state.snapshot!.participants[0],
            status: "saved",
            historyId: "history",
          },
        ],
      },
    };
    emit();
  });
  const cloud = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    readDraft: (id: string) => (id === "u" ? draft : null),
    prepareReview: jest.fn(async () => ({
      plan: state.snapshot!.plan,
      execution: { exercises: [] },
      token: "displayed-token",
      omissions: ["Private notes retained"],
      retainedLocalChanges: false,
    })),
    finish,
    leave: jest.fn(finish),
    close: jest.fn(finish),
    reviewOwn: jest.fn(finish),
  } as unknown as TogetherCloudPort;
  mockCloud = cloud;
  return {
    cloud,
    setState: (patch: Partial<TogetherCloudState>) => {
      state = { ...state, ...patch };
      emit();
    },
    state: () => state,
    retain: () => {
      draft = { ...draft, status: "in_progress" };
    },
    listeners,
  };
}
it.each([undefined, "leave", "save_own", "finish_all"])(
  "reviews exact token before %s and clears only confirmed own result",
  async (mode) => {
    const h = setup();
    mockMode = mode;
    const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
    expect(r.queryByText("Save reviewed result")).toBeNull();
    fireEvent.press(r.getByText("Review my result"));
    await waitFor(() =>
      expect(r.getByText("Save reviewed result")).toBeTruthy(),
    );
    expect(r.getByText(/Private notes retained/)).toBeTruthy();
    fireEvent.press(r.getByText("Save reviewed result"));
    await waitFor(() => expect(r.getByText("Workout saved")).toBeTruthy());
    if (mode === "finish_all" || mode === "save_own")
      expect(h.cloud.close).toHaveBeenCalledWith(mode, "displayed-token");
    else
      expect(
        mode === "leave" ? h.cloud.leave : h.cloud.finish,
      ).toHaveBeenCalledWith("displayed-token");
    fireEvent.press(r.getByText("Continue"));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledTimes(1));
    expect(mockStorage.getActiveSession("u")).toBeNull();
  },
);
it("uses reviewed execution for private continuation", async () => {
  const h = setup();
  act(() =>
    h.setState({
      phase: "private",
      snapshot: { ...h.state().snapshot!, sharingActive: false },
    }),
  );
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() =>
    expect(h.cloud.reviewOwn).toHaveBeenCalledWith(
      { exercises: [] },
      "displayed-token",
    ),
  );
});
it("ignores an old account review reply", async () => {
  const h = setup();
  let resolve!: (
    value: Awaited<ReturnType<TogetherCloudPort["prepareReview"]>>,
  ) => void;
  jest.mocked(h.cloud.prepareReview).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await act(async () => {});
  mockUser = "other";
  r.rerender(<TogetherCloudRecoveryContainer />);
  await act(async () =>
    resolve({
      plan: { name: "old", exercises: [] },
      execution: { exercises: [] },
      token: "old",
      omissions: [],
      retainedLocalChanges: false,
    }),
  );
  expect(r.queryByText("Save reviewed result")).toBeNull();
  expect(h.cloud.finish).not.toHaveBeenCalled();
});
it("rejects duplicate save presses and reports stale review failure without clearing", async () => {
  const h = setup();
  let reject!: (error: Error) => void;
  jest.mocked(h.cloud.finish).mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  fireEvent.press(r.getByText("Save reviewed result"));
  await act(async () => {});
  expect(h.cloud.finish).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("cloud-review-stale")));
  expect(r.getByText(/cloud-review-stale/)).toBeTruthy();
  expect(mockStorage.getActiveSession("u")).not.toBeNull();
});
it("shows unavailable capability honestly and permits back", () => {
  setup();
  mockCloud = undefined;
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  expect(r.getByText(/unavailable/)).toBeTruthy();
  fireEvent.press(r.getByText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it("keeps a saved partial draft active and preserves a newer personal workout", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText("Continue")).toBeTruthy());
  h.retain();
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockStorage.getActiveSession("u")).not.toBeNull();
});
it("shows synchronous review failure and never claims an unconfirmed finish", async () => {
  const h = setup();
  jest.mocked(h.cloud.prepareReview).mockImplementationOnce(() => {
    throw new Error("unavailable");
  });
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText(/unavailable/)).toBeTruthy());
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  jest.mocked(h.cloud.finish).mockResolvedValue(undefined);
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText(/result-not-confirmed/)).toBeTruthy());
  expect(r.queryByText("Workout saved")).toBeNull();
});
it("rejects a review reply with no current session or own participant", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  jest.mocked(h.cloud.prepareReview).mockImplementationOnce(async () => {
    h.setState({ snapshot: undefined });
    return {
      plan: { name: "draft", exercises: [] },
      execution: { exercises: [] },
      token: "token",
      omissions: [],
      retainedLocalChanges: false,
    };
  });
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText(/session-unavailable/)).toBeTruthy());
  act(() =>
    h.setState({
      snapshot: {
        sessionId: "s",
        state: "active",
        sharingActive: true,
        continuation: null,
        hostId: "other",
        revision: 2,
        planVersion: 1,
        plan: { name: "draft", exercises: [] },
        participants: [],
        completion: {
          status: "active",
          historyId: null,
          ownRevision: 0,
          recoveryMayBePending: false,
        },
      },
    }),
  );
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText(/account-changed/)).toBeTruthy());
  expect(h.cloud.finish).not.toHaveBeenCalled();
});
it("does not mutate UI for a save response after unmount", async () => {
  const h = setup();
  let resolve!: () => void;
  jest.mocked(h.cloud.finish).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await act(async () => {});
  r.unmount();
  await act(async () => resolve());
  expect(mockDismiss).not.toHaveBeenCalled();
  expect(h.listeners.size).toBe(0);
});
it("blocks old account callbacks and duplicate save callbacks independently of disabled buttons", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  const old = r.UNSAFE_getByType(TogetherRecoveryPresenter).props;
  let resolve!: () => void;
  jest.mocked(h.cloud.finish).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  act(() => {
    old.onSave();
    old.onSave();
  });
  await act(async () => {});
  expect(h.cloud.finish).toHaveBeenCalledTimes(1);
  mockUser = null;
  r.rerender(<TogetherCloudRecoveryContainer />);
  await act(async () => resolve());
  act(() => old.onSave());
  expect(h.cloud.finish).toHaveBeenCalledTimes(1);
  expect(r.getByText(/unavailable/)).toBeTruthy();
});
it("handles non-Error failures and disappearing session without losing the shown candidate", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  jest.mocked(h.cloud.prepareReview).mockRejectedValueOnce("offline");
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() =>
    expect(
      r.getByText(/Could not save this review. Your workout/),
    ).toBeTruthy(),
  );
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  act(() => h.setState({ snapshot: undefined, pendingCount: 2 }));
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText(/session-unavailable/)).toBeTruthy());
  expect(h.cloud.finish).not.toHaveBeenCalled();
  expect(r.getByText(/2 changes are still/)).toBeTruthy();
});
it("retires only its own UI pointer after confirmed completion", async () => {
  const h = setup();
  useActiveWorkout
    .getState()
    .start(pointerFromSession(h.cloud.readDraft("u")!));
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText("Continue")).toBeTruthy());
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(mockDismiss).toHaveBeenCalledTimes(1));
  expect(useActiveWorkout.getState().active).toBeNull();
});
it("preserves a newer personal cache while leaving the reviewed result", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText("Continue")).toBeTruthy());
  const next = {
    ...h.cloud.readDraft("u")!,
    id: "new",
    together: undefined,
    status: "in_progress" as const,
  };
  mockStorage.cacheActiveSession("u", next);
  useActiveWorkout.getState().start(pointerFromSession(next));
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(mockDismiss).toHaveBeenCalledTimes(1));
  expect(mockStorage.getActiveSession("u")?.id).toBe("new");
  expect(useActiveWorkout.getState().active?.sessionId).toBe("new");
  await useActiveWorkout.getState().end();
});
