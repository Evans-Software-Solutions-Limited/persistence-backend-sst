import type { TogetherExerciseShare } from "@/domain/models/togetherIdentity";
import type { ExerciseCategory } from "@/domain/models/exercise";

export interface TogetherSharedPlan {
  name: string;
  exercises: {
    planExerciseId: string;
    exerciseId: string;
    order: number;
    targetSets: number;
  }[];
}
/** What a guest needs to show a host's custom exercise it can't see (PER-60). */
export interface TogetherSharedExerciseDefinition {
  name: string;
  category: ExerciseCategory | null;
  primaryMuscles: string[];
}
export interface TogetherSharingConsent {
  numbers: boolean;
  prev: boolean;
  logging: boolean;
}
export interface TogetherPreviousRow {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  recordedAt: number;
}
export interface TogetherAthleteProjection {
  userId: string;
  revision: number;
  exercises: Record<
    string,
    {
      exerciseId: string;
      skipped: boolean;
      sets: {
        setId: string;
        reps: number;
        weightKg: number;
        completed: boolean;
      }[];
    }
  >;
  restEndsAt: string | null;
}
export interface TogetherPlanProgress {
  userId: string;
  revision: number;
  exercises: readonly {
    planExerciseId: string;
    completedSets: number;
    skipped: boolean;
  }[];
}
export interface TogetherSharedSnapshot {
  progress: readonly TogetherPlanProgress[];
  plan: TogetherSharedPlan | null;
  profiles: Readonly<Record<string, string>>;
  deliveries: readonly {
    recipientId: string;
    revision: number;
    state: "pending" | "received";
  }[];
  planHash: string | null;
  athletePlans: Readonly<Record<string, TogetherSharedPlan>>;
  /** Only explicitly authorized numeric projections are present. */
  athletes: readonly TogetherAthleteProjection[];
  previous: Readonly<Record<string, readonly TogetherPreviousRow[]>>;
  /** Own grants and grants addressed to self; no other athlete's recipient list. */
  grants: readonly {
    ownerId: string;
    recipientId: string;
    version: number;
    consent: TogetherSharingConsent;
  }[];
  closures: readonly {
    userId: string;
    mode: "finish_all" | "save_own" | "leave";
  }[];
  delegated: readonly {
    id: string;
    actorId: string;
    operation: Record<string, unknown>;
    grantVersion: number;
    expectedVersion: number;
  }[];
  /** The host's latest share of its custom exercises with this guest. */
  exerciseShare?: TogetherExerciseShare | null;
  /** The host's custom exercises in the plan, by exercise id, for display. */
  exerciseDefinitions?: Readonly<
    Record<string, TogetherSharedExerciseDefinition>
  >;
}
export interface TogetherSharedPort {
  getSnapshot(): TogetherSharedSnapshot;
  subscribe(listener: () => void): () => void;
  publishPlan(plan: TogetherSharedPlan): Promise<void>;
  publishProfile(displayName: string): Promise<void>;
  setOwnPlan(plan: TogetherSharedPlan): void;
  publishOwnActivity(): Promise<void>;
  setConsent(
    recipientId: string,
    consent: TogetherSharingConsent,
  ): Promise<void>;
  publishPrevious(
    recipientId: string,
    rows: readonly TogetherPreviousRow[],
    startedAt: number,
  ): Promise<void>;
  requestDelegatedSet(
    ownerId: string,
    operation: Record<string, unknown>,
    observedRevision: number,
  ): Promise<void>;
  /** Revalidates the grant immediately before applying to the owner's personal checkpoint. */
  consumeDelegated(id: string): {
    operation: Record<string, unknown>;
    expectedVersion: number;
  };
  close(mode: "finish_all" | "save_own" | "leave"): Promise<void>;
}
