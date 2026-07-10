/**
 * Active-session domain model — M3.
 *
 * Mirrors the wire shapes declared on `ApiPort` (`ApiSession`,
 * `ApiSessionExercise`, `ApiExerciseSet`) so the SQLite cache and the
 * `recordSession` flush payload can be derived without field mapping.
 *
 * Spec: specs/05-active-session/design.md § Domain Model
 *       specs/milestones/M3-active-session/FRONTEND_BRIEF.md § Domain models
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 1
 */

import type { PersonalRecord } from "./record";

export type SessionStatus = "in_progress" | "completed" | "cancelled";

/**
 * Coach on-behalf context for a Start-live session (M18). Present only when a
 * COACH is running this session for a client on their own device. Persisted in
 * SQLite (the existence authority) alongside the session so it survives a
 * force-quit → rehydrate: the coach context CANNOT live only on the zustand /
 * AsyncStorage pointer, or a reconstruct-from-SQLite loses it and the client's
 * workout is misattributed to the coach (Inspector Brad, M18).
 */
export type SessionClientRef = {
  id: string;
  name: string;
  initials: string;
};

export type WorkoutSession = {
  /** `local-…`-prefixed UUID until the bulk-record flush returns canonical IDs. */
  id: string;
  userId: string;
  /** null for Quick Start sessions (no template). */
  workoutId: string | null;
  name: string;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  exercises: SessionExercise[];
  notes: string | null;
  /**
   * Coach on-behalf client (M18 Start-live). null/undefined for a normal
   * athlete session. When set, the finalize flush routes to the on-behalf
   * record endpoint and local history caches are NOT written for this
   * (coach) user.
   */
  withClient?: SessionClientRef | null;
};

export type SessionExercise = {
  id: string;
  sessionId: string;
  exerciseId: string;
  /**
   * Display label captured at session-start so the row renders correctly
   * even if the underlying exercise is renamed or deleted mid-session.
   */
  exerciseName: string;
  sortOrder: number;
  supersetGroup: number | null;
  isSubstituted: boolean;
  originalExerciseId: string | null;
  notes: string | null;
  sets: ExerciseSet[];
};

export type ExerciseSet = {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  /** 1-10 Rate of Perceived Exertion. Optional. */
  rpe: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  isCompleted: boolean;
  completedAt: string | null;
};

export type SessionSummary = {
  /** seconds from startedAt → completedAt (or now() for live previews). */
  duration: number;
  /** sum of weightKg × reps across completed sets only. */
  totalVolume: number;
  /** count of exercises with at least one completed set; substituted rows excluded. */
  exercisesCompleted: number;
  /** count of non-substituted exercises in the session. */
  totalExercises: number;
  setsCompleted: number;
  totalSets: number;
  personalRecords: PersonalRecord[];
};
