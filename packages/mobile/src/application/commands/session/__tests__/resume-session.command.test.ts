import { resumeSessionCommand } from "../resume-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

describe("resumeSessionCommand", () => {
  it("returns null when no in-progress session exists", () => {
    const storage = new InMemoryStorageAdapter();
    expect(resumeSessionCommand({ storage, userId: "user-1" })).toBeNull();
  });

  it("returns the active session when one is in progress", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });
    const session = resumeSessionCommand({ storage, userId: "user-1" });
    expect(session?.id).toBe("local-1");
    expect(session?.status).toBe("in_progress");
  });

  it("ignores completed sessions (status filter)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push",
      status: "completed",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: "2026-05-05T11:00:00.000Z",
      notes: null,
      exercises: [],
    });
    expect(resumeSessionCommand({ storage, userId: "user-1" })).toBeNull();
  });
});
