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

describe("ProfilesUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileRepositoryMocks.update.mockResolvedValue({
      id: "test-user-id",
      email: "test@example.com",
      fullName: "Updated User",
      username: "updated-user",
      avatarUrl: "https://example.com/avatar.jpg",
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: "1990-01-01",
      heightCm: "180",
      weightKg: "80",
      availableEquipment: [],
      accessibilityNeeds: [],
      preferredUnits: "metric",
      isProfilePublic: true,
      subscriptionId: null,
      hasUsedUserTrial: false,
      hasUsedTrainerTrial: false,
      primaryGoalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to update profile", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: "New Name" }),
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 for successful update", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fullName: "Updated User" }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return 404 when profile not found", async () => {
      profileRepositoryMocks.update.mockResolvedValue(null);
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fullName: "Updated User" }),
        }),
      );

      expect(response.status).toBe(404);
    });

    it("should return 400 when no valid fields provided", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(400);
    });

    it("should update profile data in response", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fullName: "Updated User" }),
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty("data");
      expect(data.data.fullName).toBe("Updated User");
    });

    it("should only allow updating specific fields", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName: "Updated User",
            fitnessLevel: "advanced",
          }),
        }),
      );

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          fullName: "Updated User",
          fitnessLevel: "advanced",
        }),
      );
    });

    it("should accept and persist fullName: null so the user can clear their display name", async () => {
      // Inspector Brad PR #68 high-severity find: the original schema was
      // `t.Optional(t.String())`, which rejected `null` and produced a 422
      // — making the Edit Profile screen's "clear my name" path unreachable
      // even though the DB column is nullable. Pin both the schema acceptance
      // and the downstream `repository.update(..., { fullName: null })` call.
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fullName: null }),
        }),
      );

      expect(response.status).toBe(200);
      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ fullName: null }),
      );
    });

    it("should accept and persist dateOfBirth: null so the user can clear their DOB", async () => {
      // PR #94 high-severity find: the schema was `t.Optional(t.String())`,
      // which rejected `null` with a 422 — making the Edit Profile screen's
      // "clear my DOB" path unreachable even though the DB column is
      // nullable. Schema widened to `t.Optional(t.Union([String, Null]))`.
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dateOfBirth: null }),
        }),
      );

      expect(response.status).toBe(200);
      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ dateOfBirth: null }),
      );
    });

    it("should accept and persist a valid gender (Fuel Targets TDEE input)", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gender: "female" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ gender: "female" }),
      );
    });

    it("should accept gender: null so the user can clear it", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gender: null }),
        }),
      );

      expect(response.status).toBe(200);
      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ gender: null }),
      );
    });

    it("should reject an out-of-enum gender with a 422 and not touch the repo", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gender: "banana" }),
        }),
      );

      expect(response.status).toBe(422);
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("should accept a valid YYYY-MM-DD dateOfBirth", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dateOfBirth: "1990-01-15" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ dateOfBirth: "1990-01-15" }),
      );
    });

    it("should return 400 (not 500) for a malformed dateOfBirth and not touch the repo", async () => {
      // PR #94 medium-severity find: `profiles.date_of_birth` is a Postgres
      // DATE, so an unparseable string would throw `invalid input syntax for
      // type date` deep in the UPDATE → uncaught 500. The handler validates
      // up front and returns a structured 400 instead.
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dateOfBirth: "1990-13-50" }),
        }),
      );

      expect(response.status).toBe(400);
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("should reject Feb 29 in a non-leap year with a 400", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      const response = await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dateOfBirth: "1990-02-29" }),
        }),
      );

      expect(response.status).toBe(400);
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("should convert heightCm and weightKg to strings for decimal columns", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            heightCm: 180,
            weightKg: 75.5,
          }),
        }),
      );

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          heightCm: "180",
          weightKg: "75.5",
        }),
      );
    });

    it("should pass through other optional fields to update", async () => {
      const { profilesUpdateHandler } =
        await import("../profilesUpdateHandler");
      await profilesUpdateHandler.handle(
        new Request("http://localhost/profile", {
          method: "PATCH",
          headers: {
            authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "new-username",
            avatarUrl: "https://example.com/avatar.png",
            dateOfBirth: "1995-05-15",
            availableEquipment: ["dumbbells"],
            accessibilityNeeds: [],
            preferredUnits: "imperial",
            isProfilePublic: false,
          }),
        }),
      );

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          username: "new-username",
          avatarUrl: "https://example.com/avatar.png",
          dateOfBirth: "1995-05-15",
          availableEquipment: ["dumbbells"],
          accessibilityNeeds: [],
          preferredUnits: "imperial",
          isProfilePublic: false,
        }),
      );
    });
  });
});
