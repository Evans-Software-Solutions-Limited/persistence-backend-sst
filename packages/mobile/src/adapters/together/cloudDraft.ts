import type { WorkoutSession } from "../../domain/models/session";
import type {
  CloudDraft,
  CloudExecution,
  CloudPlan,
  CloudParticipant,
} from "../../domain/ports/togetherCloud.port";
import { requestHash } from "./security/identity";
import { uuid } from "./security/schema";
export interface CloudMapping {
  exercises: Record<string, string>;
  sets: Record<string, string>;
}
export function validateCloudDraft(s: WorkoutSession): void {
  if (
    s.status !== "in_progress" ||
    s.withClient ||
    (s.restEndsAt != null && !Number.isFinite(Date.parse(s.restEndsAt))) ||
    s.retrospectiveCompletedAt != null ||
    s.retrospectiveDurationSeconds != null ||
    !Number.isFinite(Date.parse(s.startedAt)) ||
    !s.name.trim() ||
    s.name.length > 120 ||
    !s.exercises.length ||
    s.exercises.length > 100
  )
    throw new Error("cloud-workout-unsupported");
  const exercises = new Set(),
    sets = new Set();
  for (const e of s.exercises) {
    if (
      !uuid(e.exerciseId) ||
      !e.id ||
      exercises.has(e.id) ||
      e.sessionId !== s.id ||
      e.supersetGroup !== null ||
      (e.isSubstituted && !uuid(e.originalExerciseId)) ||
      (e.category !== undefined && e.category !== "strength") ||
      e.sets.length > 100 ||
      !Number.isInteger(e.sortOrder) ||
      e.sortOrder < 0 ||
      e.sortOrder > 99
    )
      throw new Error("cloud-workout-unsupported");
    exercises.add(e.id);
    for (const set of e.sets) {
      if (
        !set.id ||
        sets.has(set.id) ||
        set.sessionExerciseId !== e.id ||
        set.rpe !== null ||
        set.durationSeconds !== null ||
        set.distanceMeters !== null ||
        (set.reps !== null &&
          (!Number.isInteger(set.reps) || set.reps < 0 || set.reps > 10000)) ||
        (set.weightKg !== null &&
          (!Number.isFinite(set.weightKg) ||
            set.weightKg < 0 ||
            set.weightKg > 9999.99))
      )
        throw new Error("cloud-workout-unsupported");
      sets.add(set.id);
    }
  }
}
export function cloudProjection(
  s: WorkoutSession,
  plan: CloudPlan,
  mapping: CloudMapping,
  randomUUID: () => string,
): CloudExecution {
  validateCloudDraft(s);
  const used = new Set<string>();
  const exercises = s.exercises.map((e) => {
    let canonical = mapping.exercises[e.id];
    if (!canonical) {
      canonical =
        plan.exercises.find(
          (p) => p.exerciseId === e.exerciseId && !used.has(p.planExerciseId),
        )?.planExerciseId ?? "";
      if (!canonical) throw new Error("cloud-plan-mismatch");
      Object.defineProperty(mapping.exercises, e.id, {
        value: canonical,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const original = plan.exercises.find((p) => p.planExerciseId === canonical);
    if (
      !original ||
      used.has(canonical) ||
      (original.exerciseId !== e.exerciseId &&
        original.exerciseId !== e.originalExerciseId)
    )
      throw new Error("cloud-plan-mismatch");
    used.add(canonical);
    return {
      planExerciseId: canonical,
      skipped: e.skipped ?? false,
      substituteExerciseId:
        e.exerciseId === original.exerciseId ? null : e.exerciseId,
      sets: e.sets.flatMap((set) => {
        if (!Object.hasOwn(mapping.sets, set.id))
          Object.defineProperty(mapping.sets, set.id, {
            value: randomUUID(),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        return set.reps !== null && set.weightKg !== null
          ? [
              {
                setId: mapping.sets[set.id],
                reps: set.reps,
                weightKg: set.weightKg,
                completed: true,
              },
            ]
          : [];
      }),
    };
  });
  return { exercises, restEndsAt: s.restEndsAt ?? null };
}
export function promoteCloudDraft(
  session: WorkoutSession,
  randomUUID: () => string,
): { draft: CloudDraft; mapping: CloudMapping } {
  validateCloudDraft(session);
  if (session.together) throw new Error("cloud-authority-conflict");
  const mapping: CloudMapping = {
    exercises: Object.fromEntries(
      session.exercises.map((e) => [e.id, randomUUID()]),
    ),
    sets: {},
  };
  const plan: CloudPlan = {
    name: session.name,
    exercises: session.exercises.map((e) => ({
      planExerciseId: mapping.exercises[e.id],
      exerciseId: e.exerciseId,
      order: e.sortOrder,
      targetSets: Math.max(1, e.sets.length),
    })),
  };
  const draft: CloudDraft = {
    clientDraftId: randomUUID(),
    plan,
    ownExecution: cloudProjection(session, plan, mapping, randomUUID),
    startedAt: session.startedAt,
    personalDraft: session,
  };
  return { draft, mapping };
}
export function cloudOperations(
  before: CloudExecution,
  after: CloudExecution,
): Record<string, unknown>[] {
  const operations: Record<string, unknown>[] = [];
  for (const old of before.exercises)
    if (!after.exercises.some((e) => e.planExerciseId === old.planExerciseId))
      throw new Error("cloud-plan-mismatch");
  for (const e of after.exercises) {
    const old = before.exercises.find(
      (x) => x.planExerciseId === e.planExerciseId,
    );
    if (
      (old?.substituteExerciseId ?? null) !== (e.substituteExerciseId ?? null)
    )
      operations.push({
        type: "substitute",
        planExerciseId: e.planExerciseId,
        exerciseId: e.substituteExerciseId ?? null,
      });
    if ((old?.skipped ?? false) !== e.skipped)
      operations.push({
        type: "skip",
        planExerciseId: e.planExerciseId,
        skipped: e.skipped,
      });
    for (const s of old?.sets ?? [])
      if (!e.sets.some((x) => x.setId === s.setId))
        operations.push({
          type: "removeSet",
          planExerciseId: e.planExerciseId,
          setId: s.setId,
        });
    for (const s of e.sets)
      if (
        requestHash(old?.sets.find((x) => x.setId === s.setId) ?? null) !==
        requestHash(s)
      )
        operations.push({
          type: "upsertSet",
          planExerciseId: e.planExerciseId,
          set: s,
        });
  }
  if ((before.restEndsAt ?? null) !== (after.restEndsAt ?? null))
    operations.push({ type: "rest", endsAt: after.restEndsAt ?? null });
  return operations;
}

/** Refresh acknowledged numeric values without deleting local notes or partial rows. */
export function mergeCloudExecution(
  session: WorkoutSession,
  execution: CloudExecution,
  mapping: CloudMapping,
  randomUUID: () => string,
  plan: CloudPlan,
  catalog: CloudParticipant["exerciseCatalog"] = {},
): void {
  session.restEndsAt = execution.restEndsAt ?? null;
  for (const row of session.exercises) {
    const canonical = mapping.exercises[row.id];
    const own = execution.exercises.find((e) => e.planExerciseId === canonical);
    if (!own) continue;
    row.skipped = own.skipped;
    const base = plan.exercises.find((p) => p.planExerciseId === canonical);
    const exerciseId = own.substituteExerciseId ?? base?.exerciseId;
    if (exerciseId && exerciseId !== row.exerciseId) {
      row.originalExerciseId = own.substituteExerciseId
        ? (base?.exerciseId ?? row.exerciseId)
        : null;
      row.exerciseId = exerciseId;
      row.isSubstituted = !!own.substituteExerciseId;
    }
    const definition = catalog[row.exerciseId];
    if (definition) row.exerciseName = definition.name;
    for (const set of row.sets) {
      const id = mapping.sets[set.id];
      if (!id) continue;
      const acknowledged = own.sets.find((s) => s.setId === id);
      if (acknowledged) {
        set.weightKg = acknowledged.weightKg;
        set.reps = acknowledged.reps;
      } else if (set.weightKg !== null && set.reps !== null) {
        set.weightKg = null;
        set.reps = null;
      }
    }
    for (const set of own.sets) {
      if (row.sets.some((s) => mapping.sets[s.id] === set.setId)) continue;
      const id = randomUUID();
      mapping.sets[id] = set.setId;
      row.sets.push({
        id,
        sessionExerciseId: row.id,
        setNumber: row.sets.length + 1,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: null,
        durationSeconds: null,
        distanceMeters: null,
        isCompleted: false,
        completedAt: null,
      });
    }
  }
}
