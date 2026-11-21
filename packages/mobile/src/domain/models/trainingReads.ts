/**
 * Wire shapes of the BE-H1 training reads (PER-113, backend design H). The
 * phone builds the You page from its own training log first; these answer
 * for what the log doesn't reach (older months, the 3-month Recap, a new
 * phone). Muscle rows come from the same `@persistence/training-metrics`
 * function the phone runs, with the display group named `muscle`.
 */
import type { MuscleDisplayGroup } from "@persistence/training-metrics";
import type { RecordType } from "./record";

export type RemoteMuscleRow = {
  muscle: MuscleDisplayGroup;
  label: string;
  credit: number;
  hardSets: number;
  weeklyGuide: number;
  ratio: number;
  share: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type RemoteTotals = {
  workouts: number;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
};

export type RemoteTopLift = {
  exerciseId: string;
  name: string;
  weightKg: number;
  reps: number;
  startedAt: string;
  oneRepMaxKg: number;
  isRecord: boolean;
};

export type RemoteRecord = {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  achievedAt: string;
  sessionId: string | null;
};

/** `GET /users/me/muscle-volume?days=` */
export type RemoteMuscleVolume = {
  days: number;
  from: string;
  to: string;
  timezone: string;
  bodyType: "male" | "female";
  muscles: RemoteMuscleRow[];
  trainNext: MuscleDisplayGroup[];
  rest: MuscleDisplayGroup[];
  totals: RemoteTotals;
  topLifts: RemoteTopLift[];
  /** The workouts this answer counts (absent in answers kept before it). */
  sessionIds?: string[];
  asOf: string;
};

/** `GET /users/me/history?month=` */
export type RemoteHistoryMonth = {
  month: string;
  timezone: string;
  from: string;
  to: string;
  loggedDays: string[];
  days: {
    date: string;
    workouts: number;
    food: boolean;
    steps: boolean;
    weight: boolean;
    habits: boolean;
  }[];
  asOf: string;
};

export type RemoteHistoryWorkout = {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
  records: number;
  /** The records this workout holds (absent in answers kept before it). */
  personalRecords?: {
    exerciseId: string;
    exerciseName: string;
    recordType: RecordType;
    value: number;
    setId: string | null;
  }[];
  exercises: {
    exerciseId: string;
    name: string;
    isSubstituted: boolean;
    sets: {
      id: string;
      isCompleted: boolean;
      reps: number | null;
      weightKg: number | null;
    }[];
  }[];
};

/** `GET /users/me/history?date=` */
export type RemoteHistoryDay = {
  date: string;
  timezone: string;
  workouts: RemoteHistoryWorkout[];
  muscles: RemoteMuscleRow[];
  totals: RemoteTotals;
  calories: {
    kcal: number | null;
    targetKcal: number | null;
    result: "on" | "over" | "under" | "notLogged" | "noTarget";
    /** "current" until target history (PER-114) exists, then "history". */
    targetSource: "current" | "history";
  };
  steps: number | null;
  weightKg: number | null;
  waterCups: number;
  sleepHours: number | null;
  habits: string[];
  asOf: string;
};

/** `GET /users/me/recap?period=` */
export type RemoteRecap = {
  period: "week" | "month" | "3months";
  timezone: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  totals: RemoteTotals;
  previous: RemoteTotals;
  /** The period's workouts (absent in answers kept before it). */
  sessionIds?: string[];
  muscles: RemoteMuscleRow[];
  lifts: RemoteTopLift[];
  volume: { exerciseId: string; name: string; volumeKg: number }[];
  records: RemoteRecord[];
  together: { sessions: number; names: string[] };
  asOf: string;
};
