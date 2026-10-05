import React from "react";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherRecoveryContainer } from "../TogetherRecoveryContainer";
import {
  TogetherRecoveryPresenter,
  type TogetherRecoveryPresenterProps,
} from "../../presenters/TogetherRecoveryPresenter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { withTogetherWorkout } from "@/adapters/storage/withTogetherWorkout";
import { useActiveWorkout } from "@/state/active-workout";
import type {
  TogetherWorkoutPort,
  TogetherWorkoutReview,
} from "@/domain/ports/togetherWorkout.port";
import type { WorkoutSession } from "@/domain/models/session";
import type { Adapters } from "@/shared/types";
let mockUser: string | null = "u";
let mockParams: { localSessionId?: string | string[] } = {
  localSessionId: "local",
};
let mockAdapters: Pick<Adapters, "storage" | "togetherLobby">;
const mockBack = jest.fn(),
  mockDismiss = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: {
    replace: jest.fn(),
    back: () => mockBack(),
    dismissAll: () => mockDismiss(),
  },
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockUser ? { userId: mockUser } : null }),
}));
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => mockAdapters,
}));
function candidate(
  status: TogetherWorkoutReview["status"] = "stored_for_review",
): TogetherWorkoutReview {
  return {
    status,
    sharingActive: false,
    historySaved: status === "saved",
    sessionId: "shared",
    executionId: "own",
    revision: 7,
    startedAt: 1,
    snapshotToken: "shown-token",
    omissions: ["Private notes"],
    plan: { name: "Push", exercises: [] },
    execution: { exercises: [] },
  };
}
function setup() {
  let draft: WorkoutSession = {
    id: "local",
    userId: "u",
    workoutId: null,
    name: "Push",
    status: "in_progress",
    startedAt: "2026-10-05T10:00:00Z",
    completedAt: null,
    notes: "private",
    exercises: [],
    together: { sessionId: "shared", executionId: "own" },
  };
  let review: TogetherWorkoutReview | null = null;
  const listeners = new Set<() => void>();
  const base = new InMemoryStorageAdapter();
  base.cacheActiveSession("u", draft);
  const workout: TogetherWorkoutPort = {
    promote: jest.fn(),
    save: jest.fn(),
    getPlan: () => null,
    getOwnExecution: () => null,
    applyOwnOperation: jest.fn(),
    status: () => null,
    getActive: (user) =>
      user === "u" && draft.status === "in_progress" ? draft : null,
    read: (user, id) => (user === "u" && id === "local" ? draft : null),
    getReview: (user, id) => (user === "u" && id === "local" ? review : null),
    review: jest.fn(async () => {
      review = candidate();
      listeners.forEach((fn) => fn());
      return review;
    }),
    finish: jest.fn(async () => {
      review = candidate("saved");
      draft = { ...draft, status: "completed" };
      listeners.forEach((fn) => fn());
      return review;
    }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const storage = withTogetherWorkout(base, workout);
  mockAdapters = {
    storage,
    togetherLobby: { workout } as Adapters["togetherLobby"],
  };
  return {
    workout,
    base,
    storage,
    listeners,
    publish: (value: TogetherWorkoutReview) =>
      act(() => {
        review = value;
        listeners.forEach((fn) => fn());
      }),
    setReview: (value: TogetherWorkoutReview | null) => {
      review = value;
      if (value?.status === "saved" || value?.status === "finished_empty")
        draft = { ...draft, status: "completed" };
    },
    getReview: () => review,
  };
}
function props(r: ReturnType<typeof renderWithTheme>) {
  return r.UNSAFE_getByType(TogetherRecoveryPresenter)
    .props as TogetherRecoveryPresenterProps;
}
beforeEach(() => {
  mockUser = "u";
  mockParams = { localSessionId: "local" };
  jest.clearAllMocks();
  useActiveWorkout.setState({ active: null });
});
it("uploads only on explicit review, prevents duplicate finish, and submits the exact shown token", async () => {
  const h = setup(),
    r = renderWithTheme(<TogetherRecoveryContainer />);
  expect(h.workout.review).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  expect(r.getByText("Kept on this device: Private notes")).toBeTruthy();
  let resolve!: (v: TogetherWorkoutReview) => void;
  jest.mocked(h.workout.finish).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const save = props(r).onSave;
  act(() => {
    save();
    save();
  });
  await waitFor(() => expect(h.workout.finish).toHaveBeenCalledTimes(1));
  expect(h.workout.finish).toHaveBeenCalledWith("u", "local", 7, "shown-token");
  expect(props(r).busy).toBe(true);
  await act(async () => resolve(candidate("saved")));
  expect(props(r).busy).toBe(false);
});
it("does not substitute an unseen newer review for the token the user accepted", async () => {
  const h = setup();
  h.setReview(candidate());
  const r = renderWithTheme(<TogetherRecoveryContainer />),
    save = props(r).onSave;
  h.setReview({ ...candidate(), revision: 8, snapshotToken: "unseen" });
  act(() => save());
  await waitFor(() =>
    expect(h.workout.finish).toHaveBeenCalledWith(
      "u",
      "local",
      7,
      "shown-token",
    ),
  );
});
it.each(["account", "route", "unmount"])(
  "ignores late errors and retained callbacks after %s change",
  async (change) => {
    const h = setup();
    let reject!: (e: Error) => void;
    jest.mocked(h.workout.review).mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const r = renderWithTheme(<TogetherRecoveryContainer />),
      old = props(r);
    fireEvent.press(r.getByText("Review my result"));
    await waitFor(() => expect(h.workout.review).toHaveBeenCalledTimes(1));
    if (change === "account") mockUser = "other";
    else if (change === "route") mockParams = { localSessionId: "other" };
    if (change === "unmount") r.unmount();
    else r.rerender(<TogetherRecoveryContainer />);
    await act(async () => reject(new Error("private old account key error")));
    act(() => {
      old.onReview();
      old.onSave();
      old.onDone();
    });
    expect(h.workout.review).toHaveBeenCalledTimes(1);
    expect(h.workout.finish).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
    if (change !== "unmount")
      expect(r.queryByText(/original device key/)).toBeNull();
    expect(h.listeners.size).toBe(change === "unmount" ? 0 : 1);
  },
);
it.each([
  "missing capability",
  "signed out",
  "missing route",
  "array route",
  "wrong account",
])("disables review honestly for %s", (state) => {
  const h = setup();
  if (state === "missing capability") mockAdapters = { storage: h.storage };
  if (state === "signed out") mockUser = null;
  if (state === "wrong account") mockUser = "other";
  if (state === "missing route") mockParams = {};
  if (state === "array route")
    mockParams = { localSessionId: ["local", "other"] };
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  expect(props(r).available).toBe(false);
  fireEvent.press(r.getByText("Review my result"));
  expect(h.workout.review).not.toHaveBeenCalled();
  expect(props(r).error).not.toBe("");
  fireEvent.press(r.getByText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it.each([
  ["VERSION_CONFLICT", "changed"],
  ["device-key", "original device key"],
  ["network", "Could not confirm"],
  ["recovery-unavailable", "unavailable in this app version"],
])(
  "shows actionable %s and catches synchronous adapter failures",
  async (message, copy) => {
    const h = setup();
    jest.mocked(h.workout.review).mockImplementation(() => {
      throw new Error(message);
    });
    const r = renderWithTheme(<TogetherRecoveryContainer />);
    fireEvent.press(r.getByText("Review my result"));
    await waitFor(() => expect(r.getByText(new RegExp(copy))).toBeTruthy());
    expect(props(r).busy).toBe(false);
    expect(props(r).available).toBe(message !== "recovery-unavailable");
    expect(h.base.getActiveSession("u")?.notes).toBe("private");
  },
);
it("clears only the confirmed finished mirror and active pointer, retaining checkpoint evidence", async () => {
  const h = setup();
  useActiveWorkout.getState().start({
    sessionId: "local",
    workoutId: null,
    name: "Push",
    startedAt: "now",
  });
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() => expect(r.getByText("Save reviewed result")).toBeTruthy());
  fireEvent.press(r.getByText("Save reviewed result"));
  await waitFor(() => expect(r.getByText("Continue")).toBeTruthy());
  expect(h.base.getActiveSession("u")?.status).toBe("in_progress");
  fireEvent.press(r.getByText("Continue"));
  expect(h.base.getActiveSession("u")).toBeNull();
  expect(useActiveWorkout.getState().active).toBeNull();
  expect(h.workout.read("u", "local")?.notes).toBe("private");
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});
it("does not clear a newer personal workout or accept a changed terminal token", () => {
  const h = setup();
  h.setReview(candidate("saved"));
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  h.base.cacheActiveSession("u", {
    ...h.base.getActiveSession("u")!,
    id: "new",
  });
  useActiveWorkout.setState({
    active: {
      sessionId: "new",
      workoutId: null,
      name: "New",
      startedAt: "now",
    },
  });
  h.setReview({ ...candidate("saved"), snapshotToken: "different" });
  fireEvent.press(r.getByText("Continue"));
  expect(mockDismiss).not.toHaveBeenCalled();
  h.setReview(candidate("saved"));
  fireEvent.press(r.getByText("Continue"));
  expect(h.base.getActiveSession("u")?.id).toBe("new");
  expect(useActiveWorkout.getState().active?.sessionId).toBe("new");
});

it("cancels work queued immediately before an account change and preserves the new account's busy state", async () => {
  const h = setup(),
    r = renderWithTheme(<TogetherRecoveryContainer />);
  const first = props(r).onReview;
  act(() => {
    first();
    mockUser = "other";
    r.rerender(<TogetherRecoveryContainer />);
  });
  await act(async () => {});
  expect(h.workout.review).not.toHaveBeenCalled();
  expect(props(r).busy).toBe(false);
});
it("shows a retryable close error without discarding the confirmed result, then dismisses only once", () => {
  const h = setup();
  h.setReview(candidate("finished_empty"));
  const clear = jest
    .spyOn(h.base, "clearActiveSession")
    .mockImplementationOnce(() => {
      throw Error("disk");
    });
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  fireEvent.press(r.getByText("Continue"));
  expect(r.getByText(/local workout could not be closed/)).toBeTruthy();
  expect(mockDismiss).not.toHaveBeenCalled();
  const done = props(r).onDone;
  act(() => {
    done();
    done();
  });
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(h.getReview()?.status).toBe("finished_empty");
  clear.mockRestore();
});
it("rejects save without a visible review and Continue before server confirmation", () => {
  const h = setup(),
    r = renderWithTheme(<TogetherRecoveryContainer />);
  act(() => {
    props(r).onSave();
    props(r).onDone();
  });
  expect(h.workout.finish).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
  h.publish(candidate("saved"));
  const done = props(r).onDone;
  h.setReview(null);
  act(() => done());
  expect(mockDismiss).not.toHaveBeenCalled();
});
it("maps non-Error adapter rejection to a safe own-result retry message", async () => {
  const h = setup();
  jest.mocked(h.workout.review).mockRejectedValue("private unexpected wire");
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  fireEvent.press(r.getByText("Review my result"));
  await waitFor(() =>
    expect(r.getByText(/Could not confirm your result/)).toBeTruthy(),
  );
  expect(r.queryByText("private unexpected wire")).toBeNull();
});

it("returns to retained local changes without clearing the active workout", async () => {
  const h = setup();
  h.setReview({ ...candidate("saved"), retainedLocalChanges: true });
  const r = renderWithTheme(<TogetherRecoveryContainer />);
  fireEvent.press(r.getByText("Continue"));
  expect(require("expo-router").router.replace).toHaveBeenCalledWith(
    "/(app)/session",
  );
  expect(mockAdapters.storage.getLatestSession("u")?.id).toBe("local");
});
