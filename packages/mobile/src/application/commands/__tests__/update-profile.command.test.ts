import { updateProfileCommand } from "../update-profile.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { ProfilePageData } from "@/domain/models/profilePage";

const USER = "user-1";

function makePayload(
  overrides: Partial<ProfilePageData["profile"]> = {},
): ProfilePageData {
  return {
    profile: {
      id: USER,
      fullName: "Brad Simms",
      email: "brad@example.com",
      username: null,
      avatarUrl: null,
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: null,
      gender: null,
      heightCm: null,
      weightKg: null,
      weightUnit: "kg",
      heightUnit: "cm",
      isProfilePublic: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
    subscription: {
      tierName: null,
      tierDisplayName: null,
      status: null,
      isFreeTier: true,
      isTrainerTier: false,
      expiresAt: null,
      cancelledAt: null,
      workoutLimit: null,
      isUnlimited: false,
    },
    stats: { workoutsCompleted: 0 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
  };
}

describe("updateProfileCommand", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.cacheProfilePage(USER, makePayload());
  });

  it("enqueues a PATCH /profile mutation with the patch payload", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { fullName: "New Name" },
    );
    expect(result.ok).toBe(true);

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityType).toBe("profile");
    expect(pending[0].entityId).toBe(USER);
    expect(pending[0].endpoint).toBe("/profile");
    expect(pending[0].method).toBe("PATCH");
    expect(JSON.parse(pending[0].payload)).toEqual({ fullName: "New Name" });
  });

  it("optimistically merges the patch into the cached profile-page payload", () => {
    updateProfileCommand(
      { storage, userId: USER },
      {
        fullName: "New Name",
        dateOfBirth: "1992-06-30",
        isProfilePublic: true,
      },
    );

    const cached = storage.getCachedProfilePage(USER);
    expect(cached?.payload.profile.fullName).toBe("New Name");
    expect(cached?.payload.profile.dateOfBirth).toBe("1992-06-30");
    expect(cached?.payload.profile.isProfilePublic).toBe(true);
    // Untouched fields preserved.
    expect(cached?.payload.profile.email).toBe("brad@example.com");
    expect(cached?.payload.profile.fitnessLevel).toBe("intermediate");
  });

  it("queues and caches the template-workout preference", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { showTemplateWorkouts: false },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(storage.getPendingMutations()[0].payload)).toEqual({
      showTemplateWorkouts: false,
    });
    expect(
      storage.getCachedProfilePage(USER)?.payload.profile.showTemplateWorkouts,
    ).toBe(false);
  });

  it("coalesces rapid profile edits so the newest preference wins", () => {
    updateProfileCommand(
      { storage, userId: USER },
      { fullName: "Newest Name", showTemplateWorkouts: false },
    );
    updateProfileCommand(
      { storage, userId: USER },
      { showTemplateWorkouts: true },
    );

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].payload)).toEqual({
      fullName: "Newest Name",
      showTemplateWorkouts: true,
    });
  });

  it("enqueues fresh intent instead of coalescing into an exhausted preference", () => {
    updateProfileCommand(
      { storage, userId: USER },
      { showTemplateWorkouts: false },
    );
    const [exhausted] = storage.getPendingMutations();
    storage.markMutationFailed(exhausted.id, "rejected");
    storage.markMutationFailed(exhausted.id, "rejected");
    storage.markMutationFailed(exhausted.id, "rejected");

    updateProfileCommand(
      { storage, userId: USER },
      { showTemplateWorkouts: true },
    );

    const queued = storage.getQueuedEntriesForEntity("profile", USER);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0].payload)).toEqual({
      showTemplateWorkouts: true,
    });
    expect(queued[0].status).toBe("pending");
  });

  it("strips superseded preference from a mixed terminal retry payload", () => {
    updateProfileCommand(
      { storage, userId: USER },
      { fullName: "Still recoverable", showTemplateWorkouts: false },
    );
    const [terminal] = storage.getPendingMutations();
    storage.markMutationPermanentlyFailed(terminal.id, "invalid preference");

    updateProfileCommand(
      { storage, userId: USER },
      { showTemplateWorkouts: true },
    );

    const queued = storage.getQueuedEntriesForEntity("profile", USER);
    expect(queued).toHaveLength(2);
    expect(queued[0].status).toBe("permanently_failed");
    expect(JSON.parse(queued[0].payload)).toEqual({
      fullName: "Still recoverable",
    });
    expect(JSON.parse(queued[1].payload)).toEqual({
      showTemplateWorkouts: true,
    });

    storage.resetFailedEntries([terminal.id]);
    expect(JSON.parse(storage.getPendingMutations()[0].payload)).toEqual({
      fullName: "Still recoverable",
    });
  });

  it("is a no-op success for an empty patch (nothing enqueued)", () => {
    const result = updateProfileCommand({ storage, userId: USER }, {});
    expect(result.ok).toBe(true);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("queues dateOfBirth: null to clear the field", () => {
    storage.cacheProfilePage(USER, makePayload({ dateOfBirth: "1990-01-15" }));
    const result = updateProfileCommand(
      { storage, userId: USER },
      { dateOfBirth: null },
    );
    expect(result.ok).toBe(true);
    const pending = storage.getPendingMutations();
    expect(JSON.parse(pending[0].payload)).toEqual({ dateOfBirth: null });
    expect(
      storage.getCachedProfilePage(USER)?.payload.profile.dateOfBirth,
    ).toBe(null);
  });

  it("rejects an invalid DOB BEFORE enqueueing (no queue entry, no cache write)", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { dateOfBirth: "1990-13-50" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.fields.dateOfBirth).toBeTruthy();
    }
    expect(storage.getPendingMutations()).toHaveLength(0);
    // Cache untouched.
    expect(
      storage.getCachedProfilePage(USER)?.payload.profile.dateOfBirth,
    ).toBe(null);
  });

  it("queues heightCm and writes it to the cache", () => {
    storage.cacheProfilePage(USER, makePayload({ heightCm: null }));
    const result = updateProfileCommand(
      { storage, userId: USER },
      { heightCm: 178 },
    );
    expect(result.ok).toBe(true);
    const pending = storage.getPendingMutations();
    expect(JSON.parse(pending[0].payload)).toEqual({ heightCm: 178 });
    expect(storage.getCachedProfilePage(USER)?.payload.profile.heightCm).toBe(
      178,
    );
  });

  it("queues heightCm: null to clear the field", () => {
    storage.cacheProfilePage(USER, makePayload({ heightCm: 178 }));
    const result = updateProfileCommand(
      { storage, userId: USER },
      { heightCm: null },
    );
    expect(result.ok).toBe(true);
    expect(storage.getCachedProfilePage(USER)?.payload.profile.heightCm).toBe(
      null,
    );
  });

  it("rejects an out-of-range height BEFORE enqueueing (no queue entry, no cache write)", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { heightCm: 9999 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.fields.heightCm).toBeTruthy();
    }
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("rejects a NaN height (non-numeric text parsed upstream)", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { heightCm: Number("not-a-number") },
    );
    expect(result.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("queues weightUnit and writes it to the cache", () => {
    storage.cacheProfilePage(USER, makePayload({ weightUnit: "kg" }));
    const result = updateProfileCommand(
      { storage, userId: USER },
      { weightUnit: "lb" },
    );
    expect(result.ok).toBe(true);
    const pending = storage.getPendingMutations();
    expect(JSON.parse(pending[0].payload)).toEqual({ weightUnit: "lb" });
    expect(storage.getCachedProfilePage(USER)?.payload.profile.weightUnit).toBe(
      "lb",
    );
  });

  it("queues heightUnit and writes it to the cache, independently of weightUnit", () => {
    storage.cacheProfilePage(
      USER,
      makePayload({ weightUnit: "kg", heightUnit: "cm" }),
    );
    const result = updateProfileCommand(
      { storage, userId: USER },
      { heightUnit: "ftin" },
    );
    expect(result.ok).toBe(true);
    const pending = storage.getPendingMutations();
    expect(JSON.parse(pending[0].payload)).toEqual({ heightUnit: "ftin" });
    const cached = storage.getCachedProfilePage(USER)?.payload.profile;
    expect(cached?.heightUnit).toBe("ftin");
    // Mixed units (kg + ft/in) is the whole point of splitting this field —
    // changing one must never touch the other.
    expect(cached?.weightUnit).toBe("kg");
  });

  it("rejects a whitespace-only fullName", () => {
    const result = updateProfileCommand(
      { storage, userId: USER },
      { fullName: "   " },
    );
    expect(result.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("enqueues even when no profile-page row is cached yet (no optimistic write)", () => {
    const fresh = new InMemoryStorageAdapter();
    fresh.initialize();
    const result = updateProfileCommand(
      { storage: fresh, userId: USER },
      { fullName: "New Name" },
    );
    expect(result.ok).toBe(true);
    expect(fresh.getPendingMutations()).toHaveLength(1);
    expect(fresh.getCachedProfilePage(USER)).toBeNull();
  });
});
