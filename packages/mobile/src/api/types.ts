/**
 * Shared API types for mobile → SST backend communication.
 *
 * These mirror the backend's Elysia response shapes. As the backend grows
 * a proper shared contract package, these can be replaced with imports.
 */

// -- Generic response envelope --

export type ApiSuccessResponse<T> = { data: T };
export type ApiErrorResponse = { error: string };
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// -- Health check --

export type HealthCheckResponse = { status: string };

// -- Profile --

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

// -- Workouts --

export type Workout = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: "private" | "friends" | "public";
  estimatedDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
};

// -- Sessions --

export type SessionStatus = "in_progress" | "completed" | "cancelled";

export type WorkoutSession = {
  id: string;
  userId: string;
  workoutId: string | null;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  totalDurationSeconds: number | null;
  userNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSessionInput = {
  workoutId?: string;
  name?: string;
  status?: SessionStatus;
  userNotes?: string;
};

export type UpdateSessionInput = {
  status?: SessionStatus;
  userNotes?: string;
  sessionRating?: number;
  overallRpe?: number;
};

// -- Exercises --

export type Exercise = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  difficultyLevel: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
  isPublic: boolean;
};

// -- Sets --

export type ExerciseSet = {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  isPersonalRecord: boolean;
};

// -- Goals --

export type Goal = {
  id: string;
  userId: string;
  goalTypeId: string;
  priority: number | null;
  targetDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// -- Pagination --

export type PaginationParams = {
  limit?: number;
  offset?: number;
};
