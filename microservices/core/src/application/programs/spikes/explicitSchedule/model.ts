/** W1 executable design only. No route imports this module; inputs are trusted fixtures. */
import { addDays } from "../../scheduling";

export type Load =
  | { kind: "absolute"; value: number; unit: "kg" | "lb" }
  | { kind: "percent_1rm"; percent: number };

export interface Prescription {
  version: 1;
  workoutRevisionId: string;
  exercises: {
    exerciseId: string;
    sets: {
      reps: number;
      load: Load;
      rpe?: number;
      rir?: number;
      tempo?: string;
      restSeconds?: number;
      durationSeconds?: number;
      distance?: { value: number; unit: "m" | "km" | "mi" };
    }[];
  }[];
}

export interface ExplicitRevision {
  revisionId: string;
  mode: "explicit";
  durationDays: number;
  entries: {
    entryId: string;
    dayOffset: number;
    order: number;
    phase: string;
    prescription: Prescription;
  }[];
  restLabels: { dayOffset: number; label: string }[];
}

export interface Occurrence {
  assignmentId: string;
  entryId: string;
  revisionId: string;
  dueDate: string;
  order: number;
  prescription: Prescription;
  state: "pending" | "started" | "completed";
  protectedEdit: boolean;
}

/** Date-only arithmetic; caller has already selected an athlete-local start date. */
export function materialize(
  revision: ExplicitRevision,
  assignmentId: string,
  startDate: string,
): Occurrence[] {
  const ids = new Set<string>();
  if (!Number.isInteger(revision.durationDays) || revision.durationDays < 1) {
    throw new Error("Invalid finite duration");
  }
  const occurrences = revision.entries.map((entry): Occurrence => {
    if (
      ids.has(entry.entryId) ||
      !Number.isInteger(entry.dayOffset) ||
      entry.dayOffset < 0 ||
      entry.dayOffset >= revision.durationDays
    ) {
      throw new Error("Invalid schedule entry");
    }
    ids.add(entry.entryId);
    return {
      assignmentId,
      entryId: entry.entryId,
      revisionId: revision.revisionId,
      dueDate: addDays(startDate, entry.dayOffset),
      order: entry.order,
      prescription: structuredClone(entry.prescription),
      state: "pending",
      protectedEdit: false,
    };
  });
  return occurrences.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.order - b.order,
  );
}

/** Legacy cycles remain on their existing reader, explicit plans require both versions. */
export function delivery(
  mode: "cycle" | "explicit",
  capabilities: { explicitSchedule?: number; prescription?: number },
): "legacy_cycle" | "explicit" | "update_required" {
  if (mode === "cycle") return "legacy_cycle";
  return capabilities.explicitSchedule === 1 && capabilities.prescription === 1
    ? "explicit"
    : "update_required";
}

export interface MaxEvidence {
  value: number;
  unit: "kg" | "lb";
  measuredAt: string;
}

export function resolveLoad(load: Load, max?: MaxEvidence) {
  if (load.kind === "absolute" || !max)
    return { prescribed: structuredClone(load) };
  return {
    prescribed: structuredClone(load),
    resolved: { value: (max.value * load.percent) / 100, unit: max.unit },
    basis: structuredClone(max),
  };
}

/** Represents a DB compare-and-swap transaction, not a production lock implementation. */
export function publish(
  current: Occurrence[],
  currentVersion: number,
  expectedVersion: number,
  replacements: Occurrence[],
  today: string,
): { version: number; occurrences: Occurrence[] } {
  if (currentVersion !== expectedVersion) throw new Error("Revision conflict");
  const selected = new Map(replacements.map((item) => [item.entryId, item]));
  if (selected.size !== replacements.length)
    throw new Error("Duplicate selection");
  for (const replacement of replacements) {
    const before = current.find((item) => item.entryId === replacement.entryId);
    if (
      !before ||
      before.assignmentId !== replacement.assignmentId ||
      before.state !== "pending" ||
      before.protectedEdit ||
      before.dueDate <= today ||
      replacement.dueDate <= today ||
      replacement.state !== "pending"
    ) {
      throw new Error("Protected or unknown occurrence");
    }
  }
  return {
    version: currentVersion + 1,
    occurrences: current.map((item) =>
      structuredClone(selected.get(item.entryId) ?? item),
    ),
  };
}

export interface ExecutedSession {
  clientSessionId: string;
  snapshot: Occurrence;
  loads: ReturnType<typeof resolveLoad>[][];
}

/** Cached immutable prescription and max evidence are pinned before local logging begins. */
export function startCached(
  cached: Occurrence,
  clientSessionId: string,
  maxima: Record<string, MaxEvidence> = {},
): ExecutedSession {
  if (cached.state !== "pending") throw new Error("Occurrence already started");
  return {
    clientSessionId,
    snapshot: structuredClone(cached),
    loads: cached.prescription.exercises.map((exercise) =>
      exercise.sets.map((set) =>
        resolveLoad(set.load, maxima[exercise.exerciseId]),
      ),
    ),
  };
}

/** Reconciliation retains executed truth; it must not silently complete the revised plan. */
export function reconcile(current: Occurrence, executed: ExecutedSession) {
  if (
    current.assignmentId !== executed.snapshot.assignmentId ||
    current.entryId !== executed.snapshot.entryId
  ) {
    throw new Error("Occurrence mismatch");
  }
  return {
    executed: structuredClone(executed),
    disposition:
      current.revisionId === executed.snapshot.revisionId
        ? ("complete_occurrence" as const)
        : ("needs_reconciliation" as const),
  };
}
