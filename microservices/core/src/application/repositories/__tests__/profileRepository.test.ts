/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeUpdateChain(resolvedValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

describe("ProfileRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getById", () => {
    it("should return profile when found", async () => {
      const mockProfile = {
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
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getById("test-user-id");

      expect(result).toEqual(mockProfile);
    });

    it("should return null when profile not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getById("nonexistent-id");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update profile and return updated data", async () => {
      const mockProfile = {
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
      };

      const mockUpdatedProfile = {
        ...mockProfile,
        fullName: "Updated User",
        fitnessLevel: "intermediate",
        isProfilePublic: true,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockUpdatedProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.update("test-user-id", {
        fullName: "Updated User",
        fitnessLevel: "intermediate",
        isProfilePublic: true,
      });

      expect(result).toEqual(mockUpdatedProfile);
    });

    it("should return null when profile not found for update", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
        update: vi.fn().mockReturnValue(makeUpdateChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.update("nonexistent-id", {
        fullName: "Updated User",
      });

      expect(result).toBeNull();
    });

    it("should update updatedAt timestamp", async () => {
      const mockProfile = {
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
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      await repo.update("test-user-id", { fullName: "Updated User" });

      const updateChain = mockDb.update.mock.results[0].value;
      expect(updateChain.set).toHaveBeenCalled();
      const setCall = updateChain.set.mock.calls[0];
      expect(setCall[0]).toHaveProperty("updatedAt");
    });
  });
});
