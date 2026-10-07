import { completeTogetherSession } from "../complete-together-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";
import type { TogetherWorkoutPort } from "@/domain/ports/togetherWorkout.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
function setup(transport?: "cloud") {
  const storage = new InMemoryStorageAdapter();
  const own: WorkoutSession = {
    id: "local",
    userId: "u",
    workoutId: null,
    name: "Squat",
    status: "in_progress",
    startedAt: "2026-10-07T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
    together: {
      sessionId: "shared",
      executionId: "own",
      ...(transport ? { transport } : {}),
    },
  };
  storage.cacheActiveSession("u", own);
  const review = {
    status: "stored_for_review",
    revision: 4,
    snapshotToken: "token",
    retainedLocalChanges: false,
  };
  const finish = jest.fn(async () => {
    storage.cacheActiveSession("u", { ...own, status: "completed" });
    return { status: "saved", historyId: "history" };
  });
  const workout = {
    review: jest.fn(async () => review),
    finish,
  } as unknown as TogetherWorkoutPort;
  const result = { userId: "u", status: "active", historyId: "history" };
  const cloudFinish = jest.fn(async () => {
    await finish();
    result.status = "saved";
  });
  const snapshot = { sharingActive: true, participants: [result] };
  const cloud = {
    publishOwnDraft: jest.fn(async () => {}),
    prepareReview: jest.fn(async () => ({
      ...review,
      token: "token",
      execution: {},
    })),
    getSnapshot: () => ({ snapshot }),
    finish: cloudFinish,
    close: cloudFinish,
    leave: cloudFinish,
    reviewOwn: cloudFinish,
  } as unknown as TogetherCloudPort;
  const deps = {
    storage,
    workout,
    cloud,
    userId: "u",
    localSessionId: "local",
    isCurrent: () => true,
  };
  return { deps, own, review, snapshot, finish, cloudFinish };
}
const input = { rating: 7, notes: " Good effort " };
it("accepts own result and updates rating without a duplicate bulk record", async () => {
  const h = setup();
  expect((await completeTogetherSession(h.deps, input)).status).toBe(
    "completed",
  );
  expect(h.finish).toHaveBeenCalledWith("u", "local", 4, "token");
  expect(h.deps.storage.getActiveSession("u")).toBeNull();
  expect(h.deps.storage.getPendingMutations()).toEqual([
    expect.objectContaining({
      endpoint: "/sessions/history",
      method: "PATCH",
      payload: JSON.stringify({ sessionRating: 7, userNotes: "Good effort" }),
    }),
  ]);
});
it.each([undefined, "finish_all", "save_own", "leave"])(
  "completes cloud with mode %s",
  async (mode) => {
    const h = setup("cloud");
    await completeTogetherSession(h.deps, { ...input, mode });
    expect(h.cloudFinish).toHaveBeenCalledWith(
      ...(mode === "finish_all" || mode === "save_own"
        ? [mode, "token"]
        : ["token"]),
    );
    expect(h.deps.storage.getActiveSession("u")).toBeNull();
  },
);
it("reviews own execution after sharing ends", async () => {
  const h = setup("cloud");
  h.snapshot.sharingActive = false;
  await completeTogetherSession(h.deps, input);
  expect(h.cloudFinish).toHaveBeenCalledWith({}, "token");
});
it.each([undefined, "cloud"] as const)(
  "requires explicit review for unsupported %s changes",
  async (transport) => {
    const h = setup(transport);
    h.review.retainedLocalChanges = true;
    await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
      "review-required",
    );
    expect(h.finish).not.toHaveBeenCalled();
    expect(h.deps.storage.getActiveSession("u")).not.toBeNull();
    expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
  },
);
it("rejects account change during upload", async () => {
  const h = setup();
  jest.spyOn(h.deps.workout, "review").mockImplementation(async () => {
    h.deps.isCurrent = () => false;
    return h.review as never;
  });
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "account-changed",
  );
  expect(h.finish).not.toHaveBeenCalled();
});
it("does not clear a newer workout after save", async () => {
  const h = setup();
  h.finish.mockImplementation(async () => {
    h.deps.storage.cacheActiveSession("u", { ...h.own, id: "new" });
    return { status: "saved", historyId: "history" };
  });
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "workout-changed",
  );
  expect(h.deps.storage.getActiveSession("u")?.id).toBe("new");
  expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
});
it("retains the workout on ambiguous save failure", async () => {
  const h = setup();
  h.finish.mockRejectedValue(new Error("timeout"));
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "timeout",
  );
  expect(h.deps.storage.getActiveSession("u")?.id).toBe("local");
});
it("does not write a rating for an empty confirmed result", async () => {
  const h = setup();
  h.finish.mockImplementation(async () => {
    h.deps.storage.cacheActiveSession("u", { ...h.own, status: "cancelled" });
    return { status: "finished_empty", historyId: null } as never;
  });
  expect((await completeTogetherSession(h.deps, input)).status).toBe(
    "cancelled",
  );
  expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
});

it.each([undefined, "cloud"] as const)(
  "fails safely if the %s adapter is unavailable",
  async (transport) => {
    const h = setup(transport);
    const deps = {
      ...h.deps,
      ...(transport ? { cloud: undefined } : { workout: undefined }),
    };
    await expect(completeTogetherSession(deps, input)).rejects.toThrow(
      "recovery-unavailable",
    );
    expect(h.deps.storage.getActiveSession("u")).not.toBeNull();
  },
);
it("rejects a missing or unconfirmed cloud result", async () => {
  const h = setup("cloud");
  jest.spyOn(h.deps.cloud, "getSnapshot").mockReturnValue({} as never);
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "recovery-unavailable",
  );
  jest
    .spyOn(h.deps.cloud, "getSnapshot")
    .mockReturnValue({ snapshot: h.snapshot } as never);
  h.cloudFinish.mockImplementation(async () => {});
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "result-not-confirmed",
  );
  expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
});
it("rejects incomplete local confirmation and retains unsupported active remainder", async () => {
  const h = setup();
  h.finish.mockResolvedValue({
    status: "stored_for_review",
    historyId: "history",
  });
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "result-not-confirmed",
  );
  h.finish.mockResolvedValue({ status: "saved", historyId: "history" });
  await expect(completeTogetherSession(h.deps, input)).rejects.toThrow(
    "review-required",
  );
  expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
});
it("rates an already saved cloud workout without issuing another finish", async () => {
  const h = setup("cloud");
  await h.cloudFinish();
  h.cloudFinish.mockClear();
  await completeTogetherSession(h.deps, input);
  expect(h.cloudFinish).not.toHaveBeenCalled();
  expect(h.deps.cloud.publishOwnDraft).not.toHaveBeenCalled();
});
it("closes an already empty cloud result without fabricating history", async () => {
  const h = setup("cloud");
  h.snapshot.participants[0].status = "finished_empty";
  h.snapshot.participants[0].historyId = "";
  h.deps.storage.cacheActiveSession("u", { ...h.own, status: "cancelled" });
  expect((await completeTogetherSession(h.deps, input)).status).toBe(
    "cancelled",
  );
  expect(h.cloudFinish).not.toHaveBeenCalled();
  expect(h.deps.storage.getPendingMutations()).toHaveLength(0);
});
