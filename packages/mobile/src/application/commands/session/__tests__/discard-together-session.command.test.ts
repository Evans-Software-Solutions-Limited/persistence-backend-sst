import { discardTogetherSession } from "../discard-together-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";
const draft: WorkoutSession = {
  id: "local",
  userId: "u",
  workoutId: null,
  name: "Own",
  status: "in_progress",
  startedAt: "2026-10-07T10:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [],
  together: { sessionId: "shared", executionId: "own" },
};
it.each([null, "other", "solo"])(
  "refuses an absent or replaced target (%s)",
  (kind) => {
    const storage = new InMemoryStorageAdapter();
    if (kind)
      storage.cacheActiveSession("u", {
        ...draft,
        ...(kind === "other" ? { id: kind } : { together: undefined }),
      });
    expect(() =>
      discardTogetherSession({ storage, userId: "u", localSessionId: "local" }),
    ).toThrow("workout-changed");
    if (kind) expect(storage.getActiveSession("u")).not.toBeNull();
  },
);
it.each([undefined, "cloud"] as const)(
  "keeps the own %s draft when retirement is unavailable",
  (transport) => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("u", {
      ...draft,
      together: { ...draft.together!, transport },
    });
    expect(() =>
      discardTogetherSession({ storage, userId: "u", localSessionId: "local" }),
    ).toThrow("discard-unavailable");
    expect(storage.getActiveSession("u")).not.toBeNull();
  },
);
