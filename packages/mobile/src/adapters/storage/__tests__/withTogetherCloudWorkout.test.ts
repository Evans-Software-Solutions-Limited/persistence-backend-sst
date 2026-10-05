import { withTogetherCloudWorkout } from "../withTogetherCloudWorkout";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
const draft = (): WorkoutSession => ({
  id: "local",
  userId: "u",
  workoutId: null,
  name: "Workout",
  status: "in_progress",
  startedAt: "2026-10-04T10:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [],
});
const marker = {
  sessionId: "cloud",
  executionId: "own",
  transport: "cloud" as const,
};
function setup() {
  const base = new InMemoryStorageAdapter(),
    mirror = new InMemoryStorageAdapter();
  let stored: WorkoutSession | null = null;
  const cloud = {
    readDraft: jest.fn(() => stored),
    saveDraft: jest.fn((_: string, s: WorkoutSession) => {
      stored = { ...s, together: marker };
    }),
    publishOwnDraft: jest.fn().mockResolvedValue(undefined),
  };
  const storage = withTogetherCloudWorkout(
    base,
    cloud as unknown as TogetherCloudPort,
    mirror,
  );
  return {
    base,
    mirror,
    cloud,
    storage,
    set: (s: WorkoutSession | null) => {
      stored = s;
    },
  };
}
it("preserves absent capability and ordinary personal storage methods", () => {
  const s = setup();
  expect(withTogetherCloudWorkout(s.base, undefined, s.mirror)).toBe(s.base);
  expect(s.storage.getLatestSession("u")).toBeNull();
  expect(s.storage.getActiveSession("u")).toBeNull();
  s.storage.cacheActiveSession("u", draft());
  expect(s.storage.getLatestSession("u")).toEqual(draft());
  expect(s.storage.getActiveSession("u")).toEqual(draft());
  expect(s.storage.getSessionSets("u", "local", "missing")).toEqual([]);
  s.storage.invalidateDashboard("u");
  s.storage.clearActiveSession("u");
  expect(s.base.getActiveSession("u")).toBeNull();
});
it("pending unmarked drafts cannot fall through solo or be cleared/replaced", () => {
  const s = setup();
  s.set(draft());
  expect(s.storage.getActiveSession("u")).toEqual(draft());
  expect(s.storage.getLatestSession("u")).toEqual(draft());
  expect(() => s.storage.clearActiveSession("u")).toThrow("retained");
  expect(() =>
    s.storage.cacheActiveSession("u", { ...draft(), id: "next" }),
  ).toThrow("retained");
  s.storage.cacheActiveSession("u", { ...draft(), notes: "saved" });
  expect(s.cloud.saveDraft).toHaveBeenCalled();
  expect(s.base.getActiveSession("u")).toBeNull();
  expect(s.mirror.getActiveSession("u")?.notes).toBe("saved");
  expect(s.cloud.publishOwnDraft).toHaveBeenCalled();
  expect(s.storage.getSessionSets("u", "local", "missing")).toEqual([]);
});
it("never routes orphan cloud mirrors to solo storage", () => {
  const s = setup(),
    orphan = { ...draft(), together: marker };
  s.base.cacheActiveSession("u", orphan);
  expect(s.storage.getActiveSession("u")).toBeNull();
  expect(s.storage.getLatestSession("u")).toBeNull();
  expect(s.storage.getSessionSets("u", "local", "x")).toEqual([]);
  expect(() => s.storage.cacheActiveSession("u", orphan)).toThrow(
    "unavailable",
  );
});
it("rejects cross-account input and ignores stale account snapshots", () => {
  const s = setup();
  s.set({ ...draft(), userId: "other" });
  expect(s.storage.getActiveSession("u")).toBeNull();
  expect(s.storage.getLatestSession("u")).toBeNull();
  expect(() =>
    s.storage.cacheActiveSession("u", { ...draft(), userId: "other" }),
  ).toThrow("account");
});
it("durable failure prevents mirror and publication; mirror/network failure retains checkpoint", async () => {
  const s = setup();
  s.set(draft());
  s.cloud.saveDraft.mockImplementationOnce(() => {
    throw Error("disk");
  });
  expect(() => s.storage.cacheActiveSession("u", draft())).toThrow("disk");
  expect(s.cloud.publishOwnDraft).not.toHaveBeenCalled();
  jest.spyOn(s.mirror, "cacheActiveSession").mockImplementation(() => {
    throw Error("mirror");
  });
  s.cloud.publishOwnDraft.mockRejectedValueOnce(Error("offline"));
  s.storage.cacheActiveSession("u", { ...draft(), notes: "durable" });
  await Promise.resolve();
  expect(s.storage.getActiveSession("u")?.notes).toBe("durable");
});
it("does not mirror an account switched during persistence", () => {
  const s = setup();
  s.set(draft());
  const write = jest.spyOn(s.mirror, "cacheActiveSession");
  s.cloud.saveDraft.mockImplementationOnce(() =>
    s.set({ ...draft(), userId: "other" }),
  );
  s.storage.cacheActiveSession("u", draft());
  expect(write).not.toHaveBeenCalled();
});
it("confirmed finish permits a fresh personal workout despite backwards clock correction", () => {
  const s = setup();
  const completed = {
    ...draft(),
    status: "completed" as const,
    together: marker,
  };
  s.set(completed);
  s.base.cacheActiveSession("u", completed);
  expect(s.storage.getLatestSession("u")).toEqual(completed);
  expect(s.storage.getActiveSession("u")).toBeNull();
  s.storage.clearActiveSession("u");
  s.storage.cacheActiveSession("u", {
    ...draft(),
    id: "new",
    startedAt: "2025-01-01T00:00:00Z",
  });
  expect(s.storage.getLatestSession("u")?.id).toBe("new");
  expect(s.storage.getActiveSession("u")?.id).toBe("new");
});
it("reads exact own exercise sets from the durable projection", () => {
  const s = setup();
  const set = {
    id: "set",
    sessionExerciseId: "ex",
    setNumber: 1,
    weightKg: 20,
    reps: 8,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    isCompleted: true,
    completedAt: "2026-10-04T10:01:00Z",
  };
  s.set({
    ...draft(),
    exercises: [
      {
        id: "ex",
        sessionId: "local",
        exerciseId: "bench",
        exerciseName: "Bench",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [set],
      },
    ],
  });
  expect(s.storage.getSessionSets("u", "local", "bench")).toEqual([set]);
  expect(s.storage.getSessionSets("u", "local", "squat")).toEqual([]);
});
