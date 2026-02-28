/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const profileRepositoryMocks = {
  getById: vi.fn(),
  update: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return {
      sub: "test-user-id",
      email: "test@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/profileRepository", () => ({
  ProfileRepository: vi.fn().mockImplementation(() => profileRepositoryMocks),
}));

describe("ProfilesGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileRepositoryMocks.getById.mockResolvedValue({
      id: "test-user-id",
      email: "test@example.com",
      fullName: "Test User",
      username: "testuser",
      avatarUrl: null,
      role: "user",
      fitnessLevel: "beginner",
      dateOfBirth: null,
      heightCm: null,
      weightKg: null,
      availableEquipment: [],
      accessibilityNeeds: [],
      preferredUnits: "metric",
      isProfilePublic: false,
      subscriptionId: null,
      hasUsedUserTrial: false,
      hasUsedTrainerTrial: false,
      primaryGoalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to get profile", async () => {
      const { profilesGetHandler } = await import("../profilesGetHandler");
      const response = await profilesGetHandler.handle(
        new Request("http://localhost/profile", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 for authenticated user getting their profile", async () => {
      const { profilesGetHandler } = await import("../profilesGetHandler");
      const response = await profilesGetHandler.handle(
        new Request("http://localhost/profile", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return profile data in response", async () => {
      const { profilesGetHandler } = await import("../profilesGetHandler");
      const response = await profilesGetHandler.handle(
        new Request("http://localhost/profile", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data.id).toBe("test-user-id");
    });

    it("should return 404 when profile not found", async () => {
      profileRepositoryMocks.getById.mockResolvedValue(null);
      const { profilesGetHandler } = await import("../profilesGetHandler");
      const response = await profilesGetHandler.handle(
        new Request("http://localhost/profile", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(404);
    });

    it("should call getById with correct userId", async () => {
      const { profilesGetHandler } = await import("../profilesGetHandler");
      await profilesGetHandler.handle(
        new Request("http://localhost/profile", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(profileRepositoryMocks.getById).toHaveBeenCalledWith(
        "test-user-id",
      );
    });
  });
});
