import type { ProfilePageData } from "@/domain/models/profilePage";

/**
 * Hand-crafted ProfilePageData fixture for InMemoryApiAdapter tests
 * and ProfileContainer integration tests. Mirrors the shape backend
 * handler emits for a free-tier user with no active trainers.
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
 */
export const PROFILE_PAGE_FIXTURE: ProfilePageData = {
  profile: {
    id: "user-1",
    fullName: "Brad Simms",
    email: "brad@example.com",
    username: "brad",
    avatarUrl: null,
    role: "user",
    fitnessLevel: "intermediate",
    heightCm: 180,
    weightKg: 78,
    preferredUnits: "metric",
    isProfilePublic: false,
    createdAt: "2025-09-01T00:00:00.000Z",
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
  stats: { workoutsCompleted: 12 },
  recentAchievements: [
    {
      id: "ach-1",
      name: "First workout",
      description: "Got started",
      iconUrl: null,
      unlockedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  activeTrainers: [],
  pendingTrainerRequests: [],
};
