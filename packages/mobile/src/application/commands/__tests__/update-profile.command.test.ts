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
      preferredUnits: "metric",
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
