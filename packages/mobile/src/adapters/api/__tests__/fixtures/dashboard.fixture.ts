/**
 * Hand-crafted DashboardPayload fixture for InMemoryApiAdapter tests
 * and HomeContainer integration tests.
 *
 * Mirrors the shape the backend handler will emit under typical
 * seeded-user conditions. Intentionally populated across every section
 * so the presenter + container test surface exercises each rendering
 * branch without needing per-test overrides.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard backend contract
 *       · specs/milestones/M1-home-dashboard/FRONTEND_BRIEF.md § 2
 */

import type { DashboardPayload } from "@/domain/models/dashboard";

export const DASHBOARD_FIXTURE: DashboardPayload = {
  profile: {
    id: "user-1",
    fullName: "Alex Morgan",
    firstName: "Alex",
    preferredUnits: "metric",
  },
  subscription: {
    tierName: "Pro",
    isFreeTier: false,
    isTrainerTier: false,
    status: "active",
  },
  recentWorkouts: [
    {
      id: "workout-1",
      name: "Push Day",
      description: "Chest, shoulders, triceps",
      estimatedDurationMinutes: 55,
      createdBy: "user-1",
      isAssigned: false,
      assignedByType: null,
    },
    {
      id: "workout-2",
      name: "Pull Day",
      description: "Back, biceps",
      estimatedDurationMinutes: 50,
      createdBy: "user-1",
      isAssigned: false,
      assignedByType: null,
    },
    {
      id: "workout-3",
      name: "PT Leg Programme",
      description: "Assigned by trainer",
      estimatedDurationMinutes: 65,
      createdBy: "pt-1",
      isAssigned: true,
      assignedByType: "personal_trainer",
    },
  ],
  recentActivity: [
    {
      workoutSessionId: "session-1",
      workoutId: "workout-1",
      workoutName: "Push Day",
      completedAt: "2026-04-21T18:30:00.000Z",
      durationSeconds: 3300,
    },
    {
      workoutSessionId: "session-2",
      workoutId: "workout-2",
      workoutName: "Pull Day",
      completedAt: "2026-04-19T17:45:00.000Z",
      durationSeconds: 2900,
    },
  ],
  activeGoals: [
    {
      id: "goal-1",
      title: "Bench 100kg",
      current: 90,
      target: 100,
      unit: "kg",
      priority: 1,
      targetDate: "2026-06-01",
    },
    {
      id: "goal-2",
      title: "4 workouts / week",
      current: 3,
      target: 4,
      unit: "workouts",
      priority: 2,
      targetDate: null,
    },
  ],
  progress: {
    workoutsThisMonth: 9,
    workoutsLastMonth: 12,
    streak: 4,
    personalRecordsCount: 7,
  },
  prOfTheWeek: {
    exerciseId: "exercise-bench",
    exerciseName: "Barbell Bench Press",
    recordType: "1rm",
    value: 95,
    unit: "kg",
    achievedAt: "2026-04-21T18:05:00.000Z",
  },
  latestMeasurement: {
    id: "measurement-1",
    weightKg: 78.2,
    bodyFatPercentage: 16.5,
    measuredAt: "2026-04-20T07:15:00.000Z",
  },
};
