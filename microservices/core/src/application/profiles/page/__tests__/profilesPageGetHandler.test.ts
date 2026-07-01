/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const profileRepositoryMocks = {
  getById: vi.fn(),
  update: vi.fn(),
  getProfilePageData: vi.fn(),
  getProfileSlice: vi.fn(),
  getSubscriptionSlice: vi.fn(),
  getWorkoutsCompletedCount: vi.fn(),
  getRecentAchievements: vi.fn(),
  getTrainerRelationships: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return {
      sub: "user-1",
      email: "u@e.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/profileRepository", () => ({
  ProfileRepository: vi.fn().mockImplementation(() => profileRepositoryMocks),
}));

const FULL_PAYLOAD = {
  profile: {
    id: "user-1",
    fullName: "Alex Doe",
    email: "alex@example.com",
    username: "alex",
    avatarUrl: null,
    role: "user" as const,
    fitnessLevel: "intermediate" as const,
    dateOfBirth: "1990-01-15",
    heightCm: 180,
    weightKg: 75,
    weightUnit: "kg" as const,
    heightUnit: "cm" as const,
    isProfilePublic: false,
    createdAt: "2024-01-15T10:00:00.000Z",
  },
  subscription: {
    tierName: "premium",
    tierDisplayName: "Premium",
    status: "active" as const,
    isFreeTier: false,
    isTrainerTier: false,
    expiresAt: "2026-12-31T00:00:00.000Z",
    cancelledAt: null,
    workoutLimit: null,
    isUnlimited: true,
  },
  stats: { workoutsCompleted: 42 },
  recentAchievements: [],
  activeTrainers: [],
  pendingTrainerRequests: [],
};

describe("ProfilesPageGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileRepositoryMocks.getProfilePageData.mockResolvedValue(FULL_PAYLOAD);
  });

  it("returns 401 when unauthenticated", async () => {
    const { profilesPageGetHandler } =
      await import("../profilesPageGetHandler");
    const response = await profilesPageGetHandler.handle(
      new Request("http://localhost/profile/page"),
    );
    expect(response.status).toBe(401);
    expect(profileRepositoryMocks.getProfilePageData).not.toHaveBeenCalled();
  });

  it("returns 200 with the full envelope when authenticated", async () => {
    const { profilesPageGetHandler } =
      await import("../profilesPageGetHandler");
    const response = await profilesPageGetHandler.handle(
      new Request("http://localhost/profile/page", {
        headers: { authorization: "Bearer fake" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof FULL_PAYLOAD };
    expect(body.data.profile.id).toBe("user-1");
    expect(body.data.subscription.tierName).toBe("premium");
    expect(body.data.stats.workoutsCompleted).toBe(42);
  });

  it("returns 404 when the repo returns null (profile row missing)", async () => {
    profileRepositoryMocks.getProfilePageData.mockResolvedValueOnce(null);
    const { profilesPageGetHandler } =
      await import("../profilesPageGetHandler");
    const response = await profilesPageGetHandler.handle(
      new Request("http://localhost/profile/page", {
        headers: { authorization: "Bearer fake" },
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Profile not found");
  });

  it("passes the JWT sub through to the repository", async () => {
    const { profilesPageGetHandler } =
      await import("../profilesPageGetHandler");
    await profilesPageGetHandler.handle(
      new Request("http://localhost/profile/page", {
        headers: { authorization: "Bearer fake" },
      }),
    );
    expect(profileRepositoryMocks.getProfilePageData).toHaveBeenCalledWith(
      "user-1",
    );
  });
});
