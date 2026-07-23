/**
 * Programme domain models (19-programs, Phase 9 mobile — F1 coach + F2
 * athlete Home).
 *
 * Mirrors the backend `/trainers/me/programs*` payloads 1:1 — the SST
 * backend emits camelCase, so the wire shape and this domain shape are
 * structurally identical and the adapter passes it through unchanged.
 *
 * Backend source of truth:
 *   microservices/core/src/api.ts (mounted under `/trainers/me`)
 *   specs/19-programs/{requirements,design,tasks}.md
 */

/** A workout slotted into a programme's cycle (duplicates allowed). */
export type ProgramWorkoutEntry = {
  id: string;
  workoutId: string;
  /** Order within the cycle (0-based or 1-based per backend — passthrough). */
  position: number;
  name: string;
  estimatedDurationMinutes: number | null;
};

/** A client currently (or previously) assigned to a programme. */
export type ProgramAssignmentEntry = {
  id: string;
  clientId: string;
  clientName: string;
  clientInitials: string;
  avatarUrl: string | null;
  startDate: string;
  endDate: string | null;
  /** assignment_status: assigned | started | completed | skipped. */
  status: string;
  currentWeek: number;
};

/**
 * List-row shape (`GET /trainers/me/programs`). `isActive` is NOT on the
 * wire — derive client-side as `activeClientCount > 0` per the brief; do
 * not fabricate a backend field.
 */
export type ProgramSummary = {
  id: string;
  name: string;
  description: string | null;
  /** null = indefinite/ongoing programme. */
  durationWeeks: number | null;
  daysPerWeek: number;
  workoutCount: number;
  activeClientCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Detail shape (`GET/POST/PUT /trainers/me/programs/:id`). */
export type ProgramDetail = ProgramSummary & {
  workouts: ProgramWorkoutEntry[];
  assignments: ProgramAssignmentEntry[];
};

/** Convenience alias — `ProgramDetail` IS the `Program` domain entity. */
export type Program = ProgramDetail;

/**
 * Athlete-facing programme detail (`GET /programs/:id`). Metadata + ordered
 * workout cycle + the athlete's OWN assignment context (status + current
 * week). Mirrors the backend `AthleteProgramDetail` 1:1; deliberately has NO
 * `assignments` (other clients' data). Consumed by the read-only athlete
 * programme screen so a client can open their assigned plan and start any
 * workout in it.
 */
export type AthleteProgramDetail = {
  id: string;
  name: string;
  description: string | null;
  durationWeeks: number | null;
  daysPerWeek: number;
  workoutCount: number;
  /** The athlete's assignment status for this programme. */
  status: string;
  startDate: string;
  endDate: string | null;
  /** 1-based calendar week the athlete is currently in. */
  week: number;
  workouts: ProgramWorkoutEntry[];
};

/**
 * Raw DB row returned by `POST /trainers/me/programs/:id/assign`
 * (`ProgramAssignment`, NOT the list-friendly `ProgramAssignmentEntry`).
 * camelCase wire == domain shape, passthrough.
 */
export type ProgramAssignmentRow = {
  id: string;
  programId: string;
  clientId: string;
  assignedBy: string;
  startDate: string;
  endDate: string | null;
  status: string;
  showInPlan: boolean;
  showInLibrary: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `POST /trainers/me/programs` body. */
export type CreateProgramInput = {
  name: string;
  description?: string | null;
  durationWeeks: number | null;
  daysPerWeek: number;
  workoutIds: string[];
};

/** `PUT /trainers/me/programs/:id` body — all fields optional. */
export type UpdateProgramInput = {
  name?: string;
  description?: string | null;
  durationWeeks?: number | null;
  daysPerWeek?: number;
  workoutIds?: string[];
};

/** `POST /trainers/me/programs/:id/assign` body. */
export type AssignProgramInput = {
  clientId: string;
  /** YYYY-MM-DD. */
  startDate: string;
  showInPlan?: boolean;
  showInLibrary?: boolean;
};

/** `POST /trainers/me/clients/:clientId/workout-assignments` body. */
export type AssignWorkoutInput = {
  workoutId: string;
  dueDate?: string | null;
  showInPlan?: boolean;
  showInLibrary?: boolean;
  trainerNotes?: string | null;
};

/**
 * Cache envelope for the offline-first programmes list (mirrors
 * `CachedTrainerClients`). One row per trainer userId; `payload` is the
 * full JSON-serialised list. Programme DETAIL is never cached — the editor
 * fetches it live.
 */
export type CachedPrograms = {
  userId: string;
  payload: ProgramSummary[];
  syncedAt: string;
};
